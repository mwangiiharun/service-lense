package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/improbable-eng/grpc-web/go/grpcweb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
)

type Config struct {
	BackendAddr  string
	HTTPAddr     string
	GRPCAddr     string
	UseTLS       bool
	ServerName   string
	AllowOrigin  []string
	DefaultMD    metadata.MD
	AutoAllowDev bool
}

type Server struct {
	cfg         Config
	grpcServer  *grpc.Server
	backendConn *grpc.ClientConn // nil if backend is not connected
	traffic     *trafficBuffer
}

func main() {
	cfg := loadConfig()

	if cfg.BackendAddr == "" {
		log.Fatalf("GRPS_BACKEND_ADDR must be configured (set via environment variable or UI settings)")
	}

	srv := &Server{
		cfg:         cfg,
		traffic:     newTrafficBuffer(500),
		backendConn: nil, // Will be connected lazily or on startup
	}

	// Try to connect to backend, but don't fail if it's not available yet
	// The HTTP server will start anyway and return appropriate errors
	log.Printf("Attempting to connect to gRPC backend at %s (TLS: %v)...", cfg.BackendAddr, cfg.UseTLS)
	conn, err := dialBackend(context.Background(), cfg)
	if err != nil {
		log.Printf("WARNING: Failed to connect to gRPC backend at %s: %v", cfg.BackendAddr, err)
		log.Printf("The HTTP server will start anyway. Configure the correct backend address in Settings and restart.")
		log.Printf("Make sure:\n1. The gRPC backend is running\n2. GRPS_BACKEND_ADDR is correct\n3. GRPS_BACKEND_USE_TLS matches the backend's TLS configuration")
	} else {
		log.Printf("Successfully connected to gRPC backend at %s", cfg.BackendAddr)
		srv.backendConn = conn
	}

	srv.grpcServer = grpc.NewServer(grpc.ChainUnaryInterceptor(srv.loggingUnaryInterceptor))
	reflection.Register(srv.grpcServer)

	wrapped := grpcweb.WrapServer(
		srv.grpcServer,
		grpcweb.WithOriginFunc(srv.allowOrigin),
	)

	mux := http.NewServeMux()
	mux.HandleFunc("/schema", srv.corsMiddleware(srv.schemaHandler))
	mux.HandleFunc("/traffic", srv.corsMiddleware(srv.trafficHandler))
	mux.HandleFunc("/invoke", srv.corsMiddleware(srv.invokeHandler))
	mux.HandleFunc("/inspector/capabilities", srv.corsMiddleware(srv.capabilitiesHandler))
	mux.HandleFunc("/healthz", srv.corsMiddleware(srv.healthHandler))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if wrapped.IsGrpcWebRequest(r) || wrapped.IsAcceptableGrpcCorsRequest(r) {
			wrapped.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})

	go func() {
		lis, err := net.Listen("tcp", cfg.GRPCAddr)
		if err != nil {
			log.Fatalf("listen grpc: %v", err)
		}
		log.Printf("gRPC server listening on %s\n", cfg.GRPCAddr)
		if err := srv.grpcServer.Serve(lis); err != nil {
			log.Fatalf("grpc serve: %v", err)
		}
	}()

	log.Printf("HTTP / gRPC-Web proxy listening on %s\n", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, mux); err != nil {
		log.Fatalf("http serve: %v", err)
	}
}

func loadConfig() Config {
	cfg := Config{
		BackendAddr:  envOr("GRPS_BACKEND_ADDR", "localhost:9090"), // Console gRPC server (where inspector backend connects TO)
		HTTPAddr:     envOr("GRPS_HTTP_ADDR", ":8081"),            // Inspector backend HTTP server (where UI connects)
		GRPCAddr:     envOr("GRPS_GRPC_ADDR", ":50052"),
		ServerName:   os.Getenv("GRPS_BACKEND_SERVER_NAME"),
		AllowOrigin:  splitCSV(envOr("GRPS_ALLOW_ORIGINS", "*")),
		UseTLS:       envBool("GRPS_BACKEND_USE_TLS", false),
		DefaultMD:    parseMetadata(envOr("GRPS_DEFAULT_METADATA", "")),
		AutoAllowDev: envBool("GRPS_AUTO_ALLOW_DEV_ORIGINS", true),
	}
	return cfg
}

func dialBackend(ctx context.Context, cfg Config) (*grpc.ClientConn, error) {
	var creds credentials.TransportCredentials
	if cfg.UseTLS {
		creds = credentials.NewClientTLSFromCert(nil, cfg.ServerName)
	} else {
		creds = insecure.NewCredentials()
	}

	opts := []grpc.DialOption{grpc.WithTransportCredentials(creds)}
	if cfg.ServerName != "" {
		opts = append(opts, grpc.WithAuthority(cfg.ServerName))
	}

	return grpc.DialContext(ctx, cfg.BackendAddr, opts...)
}

func (s *Server) allowOrigin(origin string) bool {
	if len(s.cfg.AllowOrigin) == 0 {
		return true
	}
	for _, allowed := range s.cfg.AllowOrigin {
		if allowed == "*" || strings.EqualFold(allowed, origin) {
			return true
		}
	}
	if s.cfg.AutoAllowDev && isLocalDevOrigin(origin) {
		return true
	}
	return false
}

// corsMiddleware wraps HTTP handlers to add CORS headers
func (s *Server) corsMiddleware(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.allowOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Grpc-Web")
			w.Header().Set("Access-Control-Expose-Headers", "grpc-status,grpc-message")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		handler(w, r)
	}
}

// setCORSHeaders is kept for backward compatibility but should use corsMiddleware instead
func (s *Server) setCORSHeaders(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if s.allowOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
}

func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func envOr(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func envBool(key string, def bool) bool {
	val := os.Getenv(key)
	if val == "" {
		return def
	}
	switch strings.ToLower(val) {
	case "1", "true", "t", "yes", "y":
		return true
	case "0", "false", "f", "no", "n":
		return false
	default:
		return def
	}
}

func splitCSV(input string) []string {
	if input == "" {
		return nil
	}
	parts := strings.Split(input, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		t := strings.TrimSpace(part)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func parseMetadata(input string) metadata.MD {
	if input == "" {
		return nil
	}
	md := metadata.MD{}
	pairs := strings.Split(input, ",")
	for _, pair := range pairs {
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		val := strings.TrimSpace(parts[1])
		if key == "" || val == "" {
			continue
		}
		md[key] = append(md[key], val)
	}
	return md
}

func isLocalDevOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if host == "localhost" || host == "127.0.0.1" {
		if port == "5173" || port == "5174" || port == "" {
			return true
		}
	}
	return false
}
