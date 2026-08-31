// components/EmptyState.tsx
import { FC } from 'react';
import { EmptyState as ChakraEmptyState, Text, Box, Image } from '@chakra-ui/react';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
}

const EmptyState: FC<EmptyStateProps> = ({ title, description, icon = '/empty-state.svg' }) => {
  return (
    <ChakraEmptyState>
      <Box textAlign="center" py={10}>
        <Image src={icon} alt="Empty state illustration" maxW="200px" mx="auto" mb={6} />
        <Text fontSize="xl" fontWeight="bold" color="gray.700" mb={2}>
          {title}
        </Text>
        {description && (
          <Text fontSize="md" color="gray.500">
            {description}
          </Text>
        )}
      </Box>
    </ChakraEmptyState>
  );
};

export default EmptyState;

// pages/transactions/index.tsx (example integration)
import { FC } from 'react';
import { useTransactions } from '@/hooks/useTransactions';
import EmptyState from '@/components/EmptyState';
import TransactionList from '@/components/TransactionList';

const TransactionsPage: FC = () => {
  const { transactions, loading } = useTransactions();

  if (loading) return <div>Loading...</div>;

  return transactions.length > 0 ? (
    <TransactionList transactions={transactions} />
  ) : (
    <EmptyState
      title="No transactions yet"
      description="Start sending or receiving payments to see your transaction history here."
    />
  );
};

export default TransactionsPage;

// pages/contacts/index.tsx
import { FC } from 'react';
import { useContacts } from '@/hooks/useContacts';
import EmptyState from '@/components/EmptyState';
import ContactList from '@/components/ContactList';

const ContactsPage: FC = () => {
  const { contacts, loading } = useContacts();

  if (loading) return <div>Loading...</div>;

  return contacts.length > 0 ? (
    <ContactList contacts={contacts} />
  ) : (
    <EmptyState
      title="No contacts yet"
      description="Add contacts to easily send payments to your friends and family."
    />
  );
};

export default ContactsPage;

// pages/wallets/index.tsx
import { FC } from 'react';
import { useWallets } from '@/hooks/useWallets';
import EmptyState from '@/components/EmptyState';
import WalletList from '@/components/WalletList';

const WalletsPage: FC = () => {
  const { wallets, loading } = useWallets();

  if (loading) return <div>Loading...</div>;

  return wallets.length > 0 ? (
    <WalletList wallets={wallets} />
  ) : (
    <EmptyState
      title="No wallets connected"
      description="Connect your bank account or wallet to start managing your funds."
    />
  );
};

export default WalletsPage;

// pages/history/index.tsx
import { FC } from 'react';
import { useHistory } from '@/hooks/useHistory';
import EmptyState from '@/components/EmptyState';
import HistoryList from '@/components/HistoryList';

const HistoryPage: FC = () => {
  const { history, loading } = useHistory();

  if (loading) return <div>Loading...</div>;

  return history.length > 0 ? (
    <HistoryList history={history} />
  ) : (
    <EmptyState
      title="No activity yet"
      description="Your activity will appear here once you start using OphirPay."
    />
  );
};

export default HistoryPage;