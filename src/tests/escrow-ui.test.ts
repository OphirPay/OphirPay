import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EscrowCreateForm } from '@/components/escrow/EscrowCreateForm';
import { EscrowDetail } from '@/components/escrow/EscrowDetail';
import { EscrowList } from '@/components/escrow/EscrowList';
import { mockEscrow, mockEscrows } from './test-data';

describe('Escrow UI Components', () => {
  describe('EscrowCreateForm', () => {
    it('should render form fields', () => {
      render(<EscrowCreateForm onSubmit={jest.fn()} />);
      expect(screen.getByLabelText('Beneficiary Address')).toBeInTheDocument();
      expect(screen.getByLabelText('Amount (ETH)')).toBeInTheDocument();
      expect(screen.getByLabelText('Asset')).toBeInTheDocument();
    });

    it('should call onSubmit with form data', async () => {
      const mockSubmit = jest.fn();
      render(<EscrowCreateForm onSubmit={mockSubmit} />);

      fireEvent.change(screen.getByLabelText('Beneficiary Address'), {
        target: { value: '0xBeneficiary' },
      });
      fireEvent.change(screen.getByLabelText('Amount (ETH)'), {
        target: { value: '1.0' },
      });
      fireEvent.click(screen.getByText('Create Escrow'));

      await waitFor(() => {
        expect(mockSubmit).toHaveBeenCalledWith({
          beneficiary: '0xBeneficiary',
          amount: expect.any(BigInt),
          asset: 'ETH',
          arbiter: undefined,
          releaseCondition: undefined,
        });
      });
    });
  });

  describe('EscrowDetail', () => {
    it('should render escrow details', () => {
      render(<EscrowDetail escrow={mockEscrow} />);
      expect(screen.getByText(`Escrow #${mockEscrow.id}`)).toBeInTheDocument();
      expect(screen.getByText(`Owner: ${mockEscrow.owner}`)).toBeInTheDocument();
      expect(screen.getByText(`Beneficiary: ${mockEscrow.beneficiary}`)).toBeInTheDocument();
    });

    it('should show owner release button', () => {
      render(<EscrowDetail escrow={mockEscrow} />);
      expect(screen.getByText('Release as Owner')).toBeInTheDocument();
    });

    it('should show beneficiary claim button', () => {
      const releasedEscrow = { ...mockEscrow, status: 'RELEASED' };
      render(<EscrowDetail escrow={releasedEscrow} />);
      expect(screen.getByText('Claim Funds')).toBeInTheDocument();
    });
  });

  describe('EscrowList', () => {
    it('should render list of escrows', () => {
      render(<EscrowList escrows={mockEscrows} />);
      expect(screen.getByText(`Escrow #${mockEscrows[0].id}`)).toBeInTheDocument();
      expect(screen.getAllByText('View').length).toBe(mockEscrows.length);
    });
  });
});
