import { Button } from '@/components/ui/button';
import { cancelStream } from '@/lib/contract-advanced';
import { useToast } from '@/components/ui/use-toast';

interface CancelStreamButtonProps {
  streamId: string;
}

export function CancelStreamButton({ streamId }: CancelStreamButtonProps) {
  const { toast } = useToast();

  const handleCancel = async () => {
    try {
      await cancelStream(streamId);
      toast({
        title: 'Success',
        description: 'Stream cancelled successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to cancel stream',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      onClick={handleCancel}
      variant="destructive"
      disabled={false}
    >
      Cancel Stream
    </Button>
  );
}