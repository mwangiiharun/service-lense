package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/dynamic"
	"github.com/jhump/protoreflect/grpcreflect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/descriptorpb"
	refv1 "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
)

type MethodInfo struct {
	Service         string                `json:"service"`
	Method          string                `json:"method"`
	FullName        string                `json:"fullName"`
	RequestType     string                `json:"requestType"`
	ResponseType    string                `json:"responseType"`
	ClientStreaming bool                  `json:"clientStreaming"`
	ServerStreaming bool                  `json:"serverStreaming"`
	MethodDesc      *desc.MethodDescriptor `json:"-"` // Internal use for generating examples
}

func collectMethods(ctx context.Context, cc *grpc.ClientConn, baseMD metadata.MD) ([]MethodInfo, error) {
	if len(baseMD) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, baseMD)
	}
	client := grpcreflect.NewClientV1Alpha(ctx, refv1.NewServerReflectionClient(cc))
	defer client.Reset()

	services, err := client.ListServices()
	if err != nil {
		log.Printf("ERROR: failed to list services via reflection: %v", err)
		return nil, fmt.Errorf("list services: %w", err)
	}

	var descriptors []*desc.ServiceDescriptor
	for _, svcName := range services {
		if svcName == "grpc.reflection.v1alpha.ServerReflection" {
			continue
		}
		svc, err := client.ResolveService(svcName)
		if err != nil {
			continue
		}
		descriptors = append(descriptors, svc)
	}

	methods := make([]MethodInfo, 0)
	for _, svc := range descriptors {
		for _, m := range svc.GetMethods() {
			full := fmt.Sprintf("/%s/%s", svc.GetFullyQualifiedName(), m.GetName())
			methods = append(methods, MethodInfo{
				Service:         svc.GetFullyQualifiedName(),
				Method:          m.GetName(),
				FullName:        full,
				RequestType:     m.GetInputType().GetFullyQualifiedName(),
				ResponseType:    m.GetOutputType().GetFullyQualifiedName(),
				ClientStreaming: m.IsClientStreaming(),
				ServerStreaming: m.IsServerStreaming(),
				MethodDesc:      m,
			})
		}
	}

	sort.Slice(methods, func(i, j int) bool {
		return methods[i].FullName < methods[j].FullName
	})

	return methods, nil
}

func (s *Server) schemaHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	methods, err := collectMethods(ctx, s.backendConn, s.cfg.DefaultMD)
	if err != nil {
		http.Error(w, "failed to load schema: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(methods)
}

// generateExamplePayload creates a sample JSON payload from a message descriptor
// It populates fields with example values based on field names and types
func generateExamplePayload(msgDesc *desc.MessageDescriptor) (map[string]any, error) {
	msg := dynamic.NewMessage(msgDesc)
	
	// Populate fields with example values
	for _, field := range msgDesc.GetFields() {
		exampleValue := generateExampleValue(field)
		if exampleValue == nil {
			continue
		}
		
		// Try to set the field, but skip if it fails (e.g., type mismatch)
		func() {
			defer func() {
				if r := recover(); r != nil {
					// Silently skip fields that cause panics (e.g., complex types)
					log.Printf("WARN: Skipping field %s due to error: %v", field.GetName(), r)
				}
			}()
			
			if field.IsRepeated() {
				// For repeated fields, add a single example element
				msg.AddRepeatedField(field, exampleValue)
			} else {
				msg.SetField(field, exampleValue)
			}
		}()
	}
	
	// Convert to JSON
	jsonBytes, err := msg.MarshalJSON()
	if err != nil {
		return nil, err
	}
	
	var result map[string]any
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return nil, err
	}
	
	// If the result is empty (no fields), return nil to indicate no example available
	if len(result) == 0 {
		return nil, nil
	}
	
	return result, nil
}

// generateExampleValue creates an example value for a field based on its type and name
func generateExampleValue(field *desc.FieldDescriptor) interface{} {
	fieldName := strings.ToLower(field.GetName())
	fieldType := field.GetType()
	
	// Skip message types (nested messages) - they're complex and would require recursive handling
	// Returning nil will skip these fields in the example
	if fieldType == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		return nil
	}
	
	// Generate value based on field name patterns first, then fall back to type
	switch {
	// String fields with semantic meaning
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_STRING:
		switch {
		case strings.Contains(fieldName, "email"):
			return "user@example.com"
		case strings.Contains(fieldName, "url") || strings.Contains(fieldName, "uri"):
			return "https://example.com"
		case strings.Contains(fieldName, "name") && !strings.Contains(fieldName, "filename"):
			return "Example Name"
		case strings.Contains(fieldName, "id") || strings.Contains(fieldName, "key"):
			return "example-id-123"
		case strings.Contains(fieldName, "token"):
			return "example-token"
		case strings.Contains(fieldName, "description"):
			return "Example description"
		case strings.Contains(fieldName, "title"):
			return "Example Title"
		case strings.Contains(fieldName, "status"):
			return "active"
		case strings.Contains(fieldName, "type"):
			return "example"
		case strings.Contains(fieldName, "path"):
			return "/example/path"
		case strings.Contains(fieldName, "address"):
			return "123 Example St, City, State 12345"
		case strings.Contains(fieldName, "phone"):
			return "+1-555-123-4567"
		case strings.Contains(fieldName, "company"):
			return "Example Company"
		case strings.Contains(fieldName, "project"):
			return "Example Project"
		default:
			return "example"
		}
	
	// Integer fields
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_INT32 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_SINT32 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		if strings.Contains(fieldName, "page") || strings.Contains(fieldName, "size") || strings.Contains(fieldName, "limit") {
			return int32(10)
		}
		if strings.Contains(fieldName, "port") {
			return int32(8080)
		}
		return int32(0)
	
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_INT64 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_SINT64 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if strings.Contains(fieldName, "page") || strings.Contains(fieldName, "size") || strings.Contains(fieldName, "limit") {
			return int64(10)
		}
		if strings.Contains(fieldName, "revenue") || strings.Contains(fieldName, "amount") || strings.Contains(fieldName, "price") {
			return int64(1000000)
		}
		if strings.Contains(fieldName, "employees") || strings.Contains(fieldName, "count") {
			return int64(100)
		}
		return int64(0)
	
	// Unsigned integer fields
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_UINT32 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return uint32(0)
	
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_UINT64 || fieldType == descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return uint64(0)
	
	// Boolean fields
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		if strings.Contains(fieldName, "allow") || strings.Contains(fieldName, "enable") || strings.Contains(fieldName, "active") {
			return true
		}
		if strings.Contains(fieldName, "delete") || strings.Contains(fieldName, "remove") {
			return false
		}
		return false
	
	// Floating point fields
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return float32(0.0)
	
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		if strings.Contains(fieldName, "price") || strings.Contains(fieldName, "amount") || strings.Contains(fieldName, "cost") {
			return 99.99
		}
		if strings.Contains(fieldName, "rate") || strings.Contains(fieldName, "percentage") {
			return 0.5
		}
		return 0.0
	
	// Bytes fields
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return []byte("example")
	
	// Enum fields - try to get first enum value
	case fieldType == descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		enumDesc := field.GetEnumType()
		if enumDesc != nil && enumDesc.GetValues() != nil && len(enumDesc.GetValues()) > 0 {
			// Return the first enum value's name as a string (JSON will serialize it)
			return enumDesc.GetValues()[0].GetName()
		}
		return ""
	}
	
	return nil
}

// Helpers for parsing full method paths like /package.Service/Method
func parseService(full string) string {
	parts := strings.Split(full, "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

func parseMethod(full string) string {
	parts := strings.Split(full, "/")
	if len(parts) < 3 {
		return ""
	}
	return parts[2]
}
