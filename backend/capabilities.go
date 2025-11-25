package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jhump/protoreflect/desc"
	"google.golang.org/protobuf/types/descriptorpb"
)

type CapabilityManifest struct {
	Version   string              `json:"version"`
	UpdatedAt time.Time           `json:"updatedAt"`
	Service   ServiceDescriptor   `json:"service"`
	Features  FeatureDescriptor   `json:"features"`
	Methods   []MethodDescriptor  `json:"methods"`
	Actions   []ActionDescriptor  `json:"actions,omitempty"`
	Telemetry TelemetryDescriptor `json:"telemetry"`
	Inspector InspectorDescriptor `json:"inspector"`
}

type ServiceDescriptor struct {
	Name        string   `json:"name"`
	Environment string   `json:"environment"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type FeatureDescriptor struct {
	SupportsInvocation bool     `json:"supportsInvocation"`
	Protocols          []string `json:"protocols"`
	TrafficFeed        bool     `json:"trafficFeed"`
	MetadataHeaders    []string `json:"metadataHeaders,omitempty"`
}

type MethodDescriptor struct {
	ID                string           `json:"id"`
	DisplayName       string           `json:"displayName"`
	Protocol          string           `json:"protocol"`
	Path              string           `json:"path"`
	RequestType       string           `json:"requestType,omitempty"`
	ResponseType      string           `json:"responseType,omitempty"`
	Schema            map[string]any   `json:"schema,omitempty"`
	BinaryFields      []string         `json:"binaryFields,omitempty"` // Field names that are bytes/binary
	Examples          []map[string]any `json:"examples,omitempty"`
	SupportsStreaming bool             `json:"supportsStreaming"`
	RequiresAuth      bool             `json:"requiresAuth"`
	Tags              []string         `json:"tags,omitempty"`
}

type ActionDescriptor struct {
	ID            string         `json:"id"`
	Label         string         `json:"label"`
	Type          string         `json:"type"`
	PayloadSchema map[string]any `json:"payloadSchema,omitempty"`
}

type TelemetryDescriptor struct {
	TrafficEndpoint  string `json:"trafficEndpoint"`
	Stream           bool   `json:"stream"`
	RetentionSeconds int    `json:"retentionSeconds"`
}

type InspectorDescriptor struct {
	CapabilitiesEndpoint string `json:"capabilitiesEndpoint"`
	InvokeEndpoint       string `json:"invokeEndpoint"`
	HealthEndpoint       string `json:"healthEndpoint"`
}

func (s *Server) capabilitiesHandler(w http.ResponseWriter, r *http.Request) {
	// Recover from panics to prevent server crashes
	defer func() {
		if r := recover(); r != nil {
			log.Printf("PANIC in capabilitiesHandler: %v", r)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}()
	
	ctx := r.Context()
	manifest, err := s.buildCapabilityManifest(ctx)
	if err != nil {
		log.Printf("ERROR: failed to collect capabilities: %v", err)
		http.Error(w, "failed to collect capabilities: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(manifest); err != nil {
		log.Printf("ERROR: failed to encode capabilities manifest: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

func (s *Server) buildCapabilityManifest(ctx context.Context) (*CapabilityManifest, error) {
	methods, err := collectMethods(ctx, s.backendConn, s.cfg.DefaultMD)
	if err != nil {
		return nil, err
	}

	methodDescriptors := make([]MethodDescriptor, 0, len(methods))
	for _, m := range methods {
		if m.FullName == "" {
			continue
		}
		
		// Generate example payload if we have the method descriptor
		var examples []map[string]any
		if m.MethodDesc != nil {
			if example, err := generateExamplePayload(m.MethodDesc.GetInputType()); err == nil && example != nil {
				examples = []map[string]any{example}
			}
		}
		
		methodDescriptors = append(methodDescriptors, MethodDescriptor{
			ID:                m.FullName,
			DisplayName:       m.Service + "/" + m.Method,
			Protocol:          "grpc",
			Path:              m.FullName,
			RequestType:       m.RequestType,
			ResponseType:      m.ResponseType,
			SupportsStreaming: m.ClientStreaming || m.ServerStreaming,
			RequiresAuth:      false,
			Examples:          examples,
		})
	}

	serviceName := os.Getenv("SERVICE_NAME")
	if serviceName == "" {
		serviceName = "console"
	}
	env := os.Getenv("SERVICE_ENV")
	if env == "" {
		env = "local"
	}

	manifest := &CapabilityManifest{
		Version:   "2024-11-25",
		UpdatedAt: time.Now().UTC(),
		Service: ServiceDescriptor{
			Name:        serviceName,
			Environment: env,
			Tags:        []string{"grpc"},
		},
		Features: FeatureDescriptor{
			SupportsInvocation: true,
			Protocols:          []string{"grpc"},
			TrafficFeed:        true,
		},
		Methods: methodDescriptors,
		Telemetry: TelemetryDescriptor{
			TrafficEndpoint:  "/traffic",
			Stream:           false,
			RetentionSeconds: 600,
		},
		Inspector: InspectorDescriptor{
			CapabilitiesEndpoint: "/inspector/capabilities",
			InvokeEndpoint:       "/invoke",
			HealthEndpoint:       "/healthz",
		},
	}

	return manifest, nil
}

// findBinaryFields recursively finds all fields of type BYTES in a message descriptor
func findBinaryFields(msgDesc *desc.MessageDescriptor) []string {
	var binaryFields []string
	
	for _, field := range msgDesc.GetFields() {
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BYTES {
			binaryFields = append(binaryFields, field.GetName())
		} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			// Recursively check nested messages
			nestedMsg := field.GetMessageType()
			if nestedMsg != nil {
				nestedFields := findBinaryFields(nestedMsg)
				// Prefix nested field names with parent field name
				for _, nestedField := range nestedFields {
					binaryFields = append(binaryFields, field.GetName()+"."+nestedField)
				}
			}
		}
	}
	
	return binaryFields
}
