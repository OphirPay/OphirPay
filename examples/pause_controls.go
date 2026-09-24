// Scoped pause controls for halting individual features without freezing all payments (#826)
package ophirpay

import (
	"sync"
)

type PauseManager struct {
	mu           sync.RWMutex
	pausedFeatures map[string]bool
}

func NewPauseManager() *PauseManager {
	return &PauseManager{
		pausedFeatures: make(map[string]bool),
	}
}

func (pm *PauseManager) PauseFeature(featureID string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.pausedFeatures[featureID] = true
}

func (pm *PauseManager) ResumeFeature(featureID string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	delete(pm.pausedFeatures, featureID)
}

func (pm *PauseManager) IsFeaturePaused(featureID string) bool {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	return pm.pausedFeatures[featureID]
}
