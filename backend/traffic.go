package main

import (
    "context"
    "encoding/json"
    "net/http"
    "sync"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/metadata"
    "google.golang.org/protobuf/encoding/protojson"
    "google.golang.org/protobuf/proto"
)

type TrafficEntry struct {
    Service   string              `json:"service"`
    Method    string              `json:"method"`
    Metadata  map[string][]string `json:"metadata"`
    Request   json.RawMessage     `json:"request"`
    Response  json.RawMessage     `json:"response"`
    Error     string              `json:"error,omitempty"`
    StartedAt time.Time           `json:"startedAt"`
    Duration  time.Duration       `json:"duration"`
}

type trafficBuffer struct {
    mu   sync.Mutex
    data []TrafficEntry
    max  int
}

func newTrafficBuffer(max int) *trafficBuffer {
    return &trafficBuffer{max: max}
}

func (tb *trafficBuffer) add(e TrafficEntry) {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    if len(tb.data) >= tb.max {
        copy(tb.data, tb.data[1:])
        tb.data[len(tb.data)-1] = e
    } else {
        tb.data = append(tb.data, e)
    }
}

func (tb *trafficBuffer) snapshot() []TrafficEntry {
    tb.mu.Lock()
    defer tb.mu.Unlock()
    out := make([]TrafficEntry, len(tb.data))
    copy(out, tb.data)
    return out
}

func toJSON(msg any) json.RawMessage {
    m, ok := msg.(proto.Message)
    if !ok || m == nil {
        return nil
    }
    b, err := protojson.Marshal(m)
    if err != nil {
        return nil
    }
    return b
}

func (s *Server) loggingUnaryInterceptor(
    ctx context.Context,
    req interface{},
    info *grpc.UnaryServerInfo,
    handler grpc.UnaryHandler,
) (interface{}, error) {
    start := time.Now()
    md, _ := metadata.FromIncomingContext(ctx)

    resp, err := handler(ctx, req)

    entry := TrafficEntry{
        Service:   parseService(info.FullMethod),
        Method:    parseMethod(info.FullMethod),
        Metadata:  map[string][]string(md),
        Request:   toJSON(req),
        Response:  toJSON(resp),
        StartedAt: start,
        Duration:  time.Since(start),
    }
    if err != nil {
        entry.Error = err.Error()
    }

    s.traffic.add(entry)
    return resp, err
}

func (s *Server) trafficHandler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    _ = json.NewEncoder(w).Encode(s.traffic.snapshot())
}
