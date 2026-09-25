import { Button } from '@/components/ui/button';
import { claimStream } from '@/lib/contract-advanced';
import { useToast } from '@/components/ui/use-toast';

interface ClaimStreamButtonProps {
  streamId: string;
}

export function ClaimStreamButton({ streamId }: ClaimStreamButtonProps) {
  const { toast } = useToast();

  const handleClaim = async () => {
    try {
      await claimStream(streamId);
      toast({
        title: 'Success',
        description: 'Stream claimed successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to claim stream',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button onClick={handleClaim} disabled={false}>
      Claim {streamId}
    </Button>
  );
}