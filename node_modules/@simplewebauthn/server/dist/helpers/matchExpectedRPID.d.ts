/**
 * Go through each expected RP ID and try to find one that matches. Raises an Error if no
 */
export declare function matchExpectedRPID(rpIDHash: Uint8Array, expectedRPIDs: string[]): Promise<void>;
