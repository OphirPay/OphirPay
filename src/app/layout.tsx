import { OfflinePage } from './offline';
import { HomePage } from './home';

export function Layout({ route }: { route: string }) {
  return route === '/offline' ? <OfflinePage /> : <HomePage />;
}