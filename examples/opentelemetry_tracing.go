// OpenTelemetry tracing helper for payment flow across API & DB (#815)
package ophirpay

import (
	"context"
	"fmt"
)

type Tracer struct {
	ServiceName string
}

func NewTracer(serviceName string) *Tracer {
	return &Tracer{ServiceName: serviceName}
}

func (t *Tracer) StartSpan(ctx context.Context, spanName string) (context.Context, func()) {
	fmt.Printf("[OpenTelemetry] Started span '%s' for service '%s'\n", spanName, t.ServiceName)
	return ctx, func() {
		fmt.Printf("[OpenTelemetry] Closed span '%s'\n", spanName)
	}
}
