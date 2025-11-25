package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	refv1 "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
)

// InvokeRequest is the payload from the UI playground.
type InvokeRequest struct {
	FullMethod string            `json:"fullMethod"`
	Metadata   map[string]string `json:"metadata"`
	Payload    map[string]any    `json:"payload"`
}

type InvokeResponse struct {
	Response map[string]any      `json:"response,omitempty"`
	Headers  map[string][]string `json:"headers,omitempty"`
	Trailers map[string][]string `json:"trailers,omitempty"`
	Error    *InvokeError        `json:"error,omitempty"`
	Meta     map[string]any      `json:"meta,omitempty"`
}

type InvokeError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

// invokeHandler executes dynamic unary RPCs against the connected backend.
func (s *Server) invokeHandler(w http.ResponseWriter, r *http.Request) {
	if s.backendConn == nil {
		http.Error(w, "Backend not connected. Please configure GRPS_BACKEND_ADDR in Settings and restart the backend.", http.StatusServiceUnavailable)
		return
	}
	var in InvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if in.FullMethod == "" {
		http.Error(w, "fullMethod is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	normalizedMethod := normalizeFullMethod(in.FullMethod)

	md := metadata.Join(s.cfg.DefaultMD, buildOutgoingMetadata(in.Metadata))
	if len(md) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, md)
	}

	start := time.Now()
	result, headers, trailers, err := s.invokeUnary(ctx, normalizedMethod, in.Payload)
	duration := time.Since(start)

	s.recordTraffic(normalizedMethod, md, in.Payload, result, err, start, duration)

	if err != nil {
		// Provide helpful error messages for common issues
		errMsg := err.Error()
		if strings.Contains(errMsg, "tls: first record does not look like a TLS handshake") {
			errMsg = "TLS mismatch: The backend is configured with TLS but the target server is not using TLS (or vice versa). Please check GRPS_BACKEND_USE_TLS in Settings and ensure it matches your gRPC backend's TLS configuration."
		} else if strings.Contains(errMsg, "connection refused") {
			errMsg = "Connection refused: The gRPC backend is not running or the address is incorrect. Please check GRPS_BACKEND_ADDR in Settings."
		} else if strings.Contains(errMsg, "no such host") {
			errMsg = "Host not found: The gRPC backend address is invalid. Please check GRPS_BACKEND_ADDR in Settings."
		}

		writeJSON(w, http.StatusBadGateway, InvokeResponse{
			Error: &InvokeError{
				Message: errMsg,
				Code:    status.Code(err).String(),
			},
		})
		return
	}

	writeJSON(w, http.StatusOK, InvokeResponse{
		Response: result,
		Headers:  metadataToMap(headers),
		Trailers: metadataToMap(trailers),
	})
}

func (s *Server) invokeUnary(ctx context.Context, fullMethod string, payload map[string]any) (map[string]any, metadata.MD, metadata.MD, error) {
	methodDesc, err := s.lookupMethodDescriptor(ctx, fullMethod)
	if err != nil {
		return nil, nil, nil, err
	}
	if methodDesc.IsServerStreaming() || methodDesc.IsClientStreaming() {
		return nil, nil, nil, errors.New("streaming methods are not supported yet")
	}

	reqJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("encode payload: %w", err)
	}

	reqMsg := dynamic.NewMessage(methodDesc.GetInputType())
	if err := reqMsg.UnmarshalJSON(reqJSON); err != nil {
		return nil, nil, nil, fmt.Errorf("decode payload: %w", err)
	}

	respMsg := dynamic.NewMessage(methodDesc.GetOutputType())

	var headerMD metadata.MD
	var trailerMD metadata.MD
	if err := s.backendConn.Invoke(ctx, fullMethod, reqMsg, respMsg, grpc.Header(&headerMD), grpc.Trailer(&trailerMD)); err != nil {
		return nil, headerMD, trailerMD, err
	}

	respJSON, err := respMsg.MarshalJSON()
	if err != nil {
		return nil, headerMD, trailerMD, fmt.Errorf("encode response: %w", err)
	}

	var respMap map[string]any
	if err := json.Unmarshal(respJSON, &respMap); err != nil {
		return nil, headerMD, trailerMD, fmt.Errorf("decode response: %w", err)
	}

	return respMap, headerMD, trailerMD, nil
}

func (s *Server) lookupMethodDescriptor(ctx context.Context, fullMethod string) (*desc.MethodDescriptor, error) {
	serviceName := parseService(fullMethod)
	methodName := parseMethod(fullMethod)
	if serviceName == "" || methodName == "" {
		return nil, fmt.Errorf("invalid full method name: %s", fullMethod)
	}

	client := grpcreflect.NewClientV1Alpha(ctx, refv1.NewServerReflectionClient(s.backendConn))
	defer client.Reset()

	svc, err := client.ResolveService(serviceName)
	if err != nil {
		return nil, fmt.Errorf("resolve service %s: %w", serviceName, err)
	}

	method := svc.FindMethodByName(methodName)
	if method == nil {
		return nil, fmt.Errorf("method %s not found on service %s", methodName, serviceName)
	}

	return method, nil
}

func buildOutgoingMetadata(src map[string]string) metadata.MD {
	if len(src) == 0 {
		return nil
	}
	out := metadata.MD{}
	for k, v := range src {
		key := strings.ToLower(strings.TrimSpace(k))
		val := strings.TrimSpace(v)
		if key == "" || val == "" {
			continue
		}
		out[key] = append(out[key], val)
	}
	return out
}

func metadataToMap(md metadata.MD) map[string][]string {
	if len(md) == 0 {
		return nil
	}
	out := make(map[string][]string, len(md))
	for k, v := range md {
		out[k] = append([]string(nil), v...)
	}
	return out
}

func normalizeFullMethod(method string) string {
	if method == "" {
		return method
	}
	if strings.HasPrefix(method, "/") {
		return method
	}
	if strings.Count(method, "/") == 1 {
		return "/" + method
	}
	return method
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) recordTraffic(fullMethod string, md metadata.MD, payload map[string]any, response map[string]any, err error, started time.Time, duration time.Duration) {
	reqJSON, _ := json.Marshal(payload)
	var respJSON []byte
	if response != nil {
		respJSON, _ = json.Marshal(response)
	}
	entry := TrafficEntry{
		Service:   parseService(fullMethod),
		Method:    parseMethod(fullMethod),
		Metadata:  metadataToMap(md),
		Request:   json.RawMessage(reqJSON),
		Response:  json.RawMessage(respJSON),
		StartedAt: started,
		Duration:  duration,
	}
	if err != nil {
		entry.Error = err.Error()
	}
	s.traffic.add(entry)
}
