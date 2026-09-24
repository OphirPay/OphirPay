// RPC failover state signal implementation for health & metrics (#820)
package ophirpay

import (
	"sync"
	"time"
)

type RPCHealthSignal struct {
	mu           sync.RWMutex
	ActiveNode   string    `json:"active_node"`
	PrimaryNode  string    `json:"primary_node"`
	BackupNode   string    `json:"backup_node"`
	IsFailover   bool      `json:"is_failover"`
	LastFailover time.Time `json:"last_failover"`
}

func NewRPCHealthSignal(primary, backup string) *RPCHealthSignal {
	return &RPCHealthSignal{
		ActiveNode:  primary,
		PrimaryNode: primary,
		BackupNode:  backup,
		IsFailover:  false,
	}
}

func (h *RPCHealthSignal) TriggerFailover() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ActiveNode = h.BackupNode
	h.IsFailover = true
	h.LastFailover = time.Now()
}

func (h *RPCHealthSignal) RestorePrimary() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ActiveNode = h.PrimaryNode
	h.IsFailover = false
}
