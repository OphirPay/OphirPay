export interface Stream {
  id: string;
  creator: string;
  recipient: string;
  total: bigint;
  vested: bigint;
  claimed: bigint;
  claimable: bigint;
  startTime: number;
  endTime: number;
  token: string;
}