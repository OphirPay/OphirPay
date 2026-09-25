// src/app/keys/page.tsx

import { getApiKeys, rotateKey, cancelRotation } from '@/lib/keys-api';
import { API_KEY_OVERLAP_WINDOW_DAYS } from '@/lib/api-auth';

// ... existing components ...

// Rotation Button Component
function RotationControls({ key }: { key: ApiKey }) {
  const [overlapDays, setOverlapDays] = useState(API_KEY_OVERLAP_WINDOW_DAYS);
  const [isRotating, setIsRotating] = useState(false);
  const [rotationCancelled, setRotationCancelled] = useState(false);

  const handleRotate = async () => {
    setIsRotating(true);
    try {
      await rotateKey(key.id, overlapDays);
      toast.success('Key rotation initiated successfully');
    } catch (error) {
      toast.error('Failed to rotate key');
    } finally {
      setIsRotating(false);
    }
  };

  const handleCancelRotation = async () => {
    if (!window.confirm('Are you sure you want to cancel this rotation?')) return;
    try {
      await cancelRotation(key.id);
      setRotationCancelled(true);
      toast.success('Rotation cancelled successfully');
    } catch (error) {
      toast.error('Failed to cancel rotation');
    }
  };

  if (key.rotatedToId) {
    return (
      <div className="rotation-status">
        <p>Rotation active until {new Date(key.overlapExpires!).toLocaleString()}</p>
        <button
          onClick={handleCancelRotation}
          disabled={isRotating}
          className="btn btn-danger"
        >
          Cancel Rotation
        </button>
      </div>
    );
  }

  return (
    <div className="rotation-controls">
      <div className="form-group">
        <label>Overlap Window (days):</label>
        <input
          type="number"
          value={overlapDays}
          onChange={(e) => setOverlapDays(parseInt(e.target.value) || API_KEY_OVERLAP_WINDOW_DAYS)}
          min="1"
          max="30"
        />
      </div>
      <button
        onClick={handleRotate}
        disabled={isRotating}
        className="btn btn-primary"
      >
        Rotate Key
      </button>
    </div>
  );
}

// Key Table Row with Rotation Support
function KeyTableRow({ key }: { key: ApiKey }) {
  return (
    <tr>
      {/* ... existing columns ... */}
      <td>
        <RotationControls key={key} />
      </td>
      <td>
        {key.rotatedToId ? (
          <span className="status active">Rotated to new key</span>
        ) : (
          <span className="status inactive">Active</span>
        )}
      </td>
    </tr>
  );
}