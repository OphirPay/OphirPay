// Prometheus metrics exporter for OphirPay API & payments (#814)
package ophirpay

import (
	"fmt"
	"net/http"
)

type MetricsExporter struct {
	Port int
}

func NewMetricsExporter(port int) *MetricsExporter {
	return &MetricsExporter{Port: port}
}

func (m *MetricsExporter) ExposeMetrics() {
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "# HELP ophirpay_payments_total Total number of processed payments\n")
		fmt.Fprintf(w, "# TYPE ophirpay_payments_total counter\n")
		fmt.Fprintf(w, "ophirpay_payments_total 42\n")
	})
}
