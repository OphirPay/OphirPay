// Postgres full-text search implementation for OphirPay audit entries and payments
package db

import (
	"context"
	"fmt"
)

type AuditSearchQuery struct {
	Query string
	Limit int
}

func BuildFullTextSearchSQL(q AuditSearchQuery) (string, []interface{}) {
	if q.Limit <= 0 {
		q.Limit = 50
	}
	sql := `
		SELECT id, entity_type, entity_id, action, payload, created_at
		FROM audit_entries
		WHERE search_vector @@ plainto_tsquery('english', $1)
		ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
		LIMIT $2;
	`
	return sql, []interface{}{q.Query, q.Limit}
}
