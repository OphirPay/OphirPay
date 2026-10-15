import React, { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { createTrustline } from '../api/stellar'; // Assuming this function exists

const AssetSelector = ({ assets, onSelect }) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);

  const handleAssetSelect = (asset) => {
    if (!asset.hasTrustline) {
      setSelectedAsset(asset);
      setShowModal(true);
    } else {
      onSelect(asset);
    }
  };

  const handleTrustlineCreation = async () => {
    try {
      await createTrustline(selectedAsset);
      alert('Trustline created successfully!');
      onSelect(selectedAsset);
    } catch (error) {
      alert('Failed to create trustline: ' + error.message);
    } finally {
      setShowModal(false);
    }
  };

  return (
    <div>
      <ul>
        {assets.map((asset) => (
          <li key={asset.id} onClick={() => handleAssetSelect(asset)}>
            {asset.name}
          </li>
        ))}
      </ul>

      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create Trustline</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>You need to create a trustline for {selectedAsset?.name} to proceed.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleTrustlineCreation}>Create Trustline</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default AssetSelector;