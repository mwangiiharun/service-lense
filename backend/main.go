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
	// TLS IS FORCED TO FALSE - always using plaintext
	log.Printf("Attempting to connect to gRPC backend at %s (TLS: FALSE - FORCED)", cfg.BackendAddr)
	log.Printf("DEBUG: GRPS_BACKEND_USE_TLS env var = %q (ignored, TLS forced to false)", os.Getenv("GRPS_BACKEND_USE_TLS"))
	log.Printf("DEBUG: UseTLS = %v (FORCED TO FALSE)", cfg.UseTLS)

	// Always create a fresh connection - close any existing one first
	srv.resetConnection()

	conn, err := dialBackend(context.Background(), cfg)
	if err != nil {
		log.Printf("WARNING: Failed to connect to gRPC backend at %s: %v", cfg.BackendAddr, err)
		log.Printf("The HTTP server will start anyway. Configure the correct backend address in Settings and restart.")
		log.Printf("Make sure:\n1. The gRPC backend is running\n2. GRPS_BACKEND_ADDR is correct (currently: %s)", cfg.BackendAddr)
		log.Printf("NOTE: TLS is FORCED TO FALSE - always using plaintext connections")
		// If it's a TLS error, this shouldn't happen but provide guidance
		if strings.Contains(err.Error(), "tls") || strings.Contains(err.Error(), "TLS") {
			log.Printf("TLS ERROR DETECTED (this shouldn't happen - TLS is forced to false):")
			log.Printf("  This may indicate a stale connection. Try fully restarting the ServiceLens app.")
			log.Printf("  Error: %v", err)
		}
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

	// Start gRPC server in a goroutine (non-blocking, non-fatal)
	// This is used for reflection but the HTTP proxy can work without it
	go func() {
		lis, err := net.Listen("tcp", cfg.GRPCAddr)
		if err != nil {
			log.Printf("WARNING: Failed to start gRPC server on %s: %v", cfg.GRPCAddr, err)
			log.Printf("The HTTP/gRPC-Web proxy will continue to work, but gRPC reflection on this port is unavailable.")
			return
		}
		log.Printf("gRPC server listening on %s\n", cfg.GRPCAddr)
		if err := srv.grpcServer.Serve(lis); err != nil {
			log.Printf("WARNING: gRPC server error: %v (HTTP proxy continues)", err)
		}
	}()

	log.Printf("HTTP / gRPC-Web proxy listening on %s\n", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, mux); err != nil {
		log.Fatalf("http serve: %v", err)
	}
}

func loadConfig() Config {
	// FORCE TLS TO FALSE - always use insecure (plaintext) connections
	// This matches grpcurl -plaintext behavior
	useTLS := false

	cfg := Config{
		BackendAddr:  envOr("GRPS_BACKEND_ADDR", "localhost:9090"), // Console gRPC server (where inspector backend connects TO)
		HTTPAddr:     envOr("GRPS_HTTP_ADDR", ":8081"),             // Inspector backend HTTP server (where UI connects)
		GRPCAddr:     envOr("GRPS_GRPC_ADDR", ":50052"),
		ServerName:   os.Getenv("GRPS_BACKEND_SERVER_NAME"),
		AllowOrigin:  splitCSV(envOr("GRPS_ALLOW_ORIGINS", "*")),
		UseTLS:       useTLS, // FORCED TO FALSE - always use plaintext
		DefaultMD:    parseMetadata(envOr("GRPS_DEFAULT_METADATA", "")),
		AutoAllowDev: envBool("GRPS_AUTO_ALLOW_DEV_ORIGINS", true),
	}
	log.Printf("FORCED TLS TO FALSE - Using plaintext (insecure) connections only")
	return cfg
}

func dialBackend(ctx context.Context, cfg Config) (*grpc.ClientConn, error) {
	// FORCE TLS TO FALSE - always use insecure (plaintext) connections
	// This matches grpcurl -plaintext behavior
	// IGNORE cfg.UseTLS completely - always use insecure
	log.Printf("FORCED: Using insecure (no TLS) credentials for connection to %s", cfg.BackendAddr)
	log.Printf("FORCED: cfg.UseTLS=%v (IGNORED - always using insecure)", cfg.UseTLS)
	creds := insecure.NewCredentials()

	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(creds),
	}
	// Remove ServerName authority - not needed for insecure connections
	// if cfg.ServerName != "" {
	// 	opts = append(opts, grpc.WithAuthority(cfg.ServerName))
	// }

	log.Printf("Dialing gRPC backend at %s with TLS=FALSE (forced, insecure only)", cfg.BackendAddr)
	conn, err := grpc.DialContext(ctx, cfg.BackendAddr, opts...)
	if err != nil {
		log.Printf("ERROR dialing backend: %v", err)
		return nil, err
	}
	log.Printf("SUCCESS: Connected to %s with insecure (no TLS) credentials", cfg.BackendAddr)
	return conn, nil
}

// resetConnection closes and clears the backend connection
func (s *Server) resetConnection() {
	if s.backendConn != nil {
		log.Printf("Closing existing backend connection...")
		if err := s.backendConn.Close(); err != nil {
			log.Printf("Error closing backend connection: %v", err)
		}
		s.backendConn = nil
		log.Printf("Backend connection reset")
	}
}

// ensureConnection ensures the backend connection exists and is healthy
// If the connection is nil or in a bad state, it recreates it
func (s *Server) ensureConnection(ctx context.Context) error {
	if s.backendConn == nil {
		log.Printf("Backend connection is nil, creating new connection...")
		conn, err := dialBackend(ctx, s.cfg)
		if err != nil {
			return err
		}
		s.backendConn = conn
		log.Printf("New backend connection created")
		return nil
	}

	// Check connection state
	state := s.backendConn.GetState()
	if state.String() == "TRANSIENT_FAILURE" || state.String() == "SHUTDOWN" || state.String() == "CONNECTING" {
		log.Printf("Backend connection is in bad state (%s), resetting and recreating...", state.String())
		s.resetConnection()
		conn, err := dialBackend(ctx, s.cfg)
		if err != nil {
			return err
		}
		s.backendConn = conn
		log.Printf("Backend connection recreated")
	}

	return nil
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
