import { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { Connection, Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, SendTransactionError } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, createSetAuthorityInstruction, AuthorityType, createAssociatedTokenAccountInstruction, createMintToInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Metaplex, walletAdapterIdentity } from '@metaplex-foundation/js';
import styles from '../styles/Home.module.css';

const WalletMultiButtonDynamic = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

const FEE_AMOUNT = 0.05 * LAMPORTS_PER_SOL;
const REVOKE_MINT_FEE = 0.025 * LAMPORTS_PER_SOL;
const TRANSFER_FEE = 0.001 * LAMPORTS_PER_SOL;
const FEE_RECIPIENT_ADDRESS = '4b3Dkfw9sdCbYRv68j3Nd3MBT8vNDTpciJTeZHCNkRBm';
const BLOCKHASH_EXPIRY_MS = 60000;

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, signAndSendTransaction, signTransaction, connected, wallet } = useWallet();
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [supply, setSupply] = useState('');
  const [decimals, setDecimals] = useState(6);
  const [status, setStatus] = useState('');
  const [tokenProgramId, setTokenProgramId] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [mintAddress, setMintAddress] = useState(null);
  const [revokeMint, setRevokeMint] = useState(false);
  const [revokeFreeze] = useState(true);
  const [selectedMintAddress, setSelectedMintAddress] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [walletReady, setWalletReady] = useState(false);

  useEffect(() => {
    try {
      const id = new PublicKey(TOKEN_PROGRAM_ID);
      setTokenProgramId(id);
      console.log('Token Program ID set:', id.toBase58());
    } catch (error) {
      console.error('Failed to set TOKEN_PROGRAM_ID:', error);
      setStatus(`Error initializing program: ${error.message}`);
    }
  }, []);

  useEffect(() => {
    if (connected && publicKey && wallet?.adapter) {
      setWalletReady(!!signAndSendTransaction || !!signTransaction);
    } else {
      setWalletReady(false);
    }
  }, [connected, publicKey, wallet, signAndSendTransaction, signTransaction]);

  const getSignAndSendTransaction = async () => {
    if (signAndSendTransaction) {
      return async (transaction, options) => {
        const { signature } = await signAndSendTransaction(transaction, options);
        return { signature };
      };
    }
    if (signTransaction) {
      return async (transaction, options) => {
        const signedTx = await signTransaction(transaction);
        if (options?.signers?.length > 0) {
          options.signers.forEach((signer) => {
            signedTx.partialSign(signer);
          });
        }
        const signature = await connection.sendRawTransaction(signedTx.serialize());
        return { signature };
      };
    }
    throw new Error('No transaction signing method available');
  };

  const ensureWalletConnected = async () => {
    if (!wallet?.adapter?.connected) {
      try {
        await wallet?.adapter?.connect();
        console.log('Wallet connected:', wallet?.adapter?.publicKey?.toBase58());
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        throw new Error('Wallet not connected. Please reconnect and try again.');
      }
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    document.getElementById('token-image').value = '';
  };

  const fetchSolPrice = async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      console.log('SOL/USD price fetched:', data.solana.usd);
      return data.solana.usd;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error);
      return null;
    }
  };

  const createToken = async () => {
    console.log('Running createToken with Metaplex SDK v4');
    if (!walletReady || !connected || !publicKey || !tokenProgramId) {
      setStatus('Please connect your wallet to Mainnet!');
      console.log('Wallet not ready or not connected');
      return;
    }

    if (!tokenName || !tokenSymbol || !supply || supply <= 0) {
      setStatus('Please fill in all token details with valid values!');
      console.log('Invalid token details');
      return;
    }

    const signAndSend = await getSignAndSendTransaction();
    let attempts = 0;
    const maxAttempts = 3;
    let tokenCreated = false;

    while (attempts < maxAttempts) {
      try {
        setStatus('Checking SOL balance...');
        console.log('Checking SOL balance...');
        const totalRequiredLamports = FEE_AMOUNT + (revokeMint ? REVOKE_MINT_FEE : 0);
        const balanceInLamports = await connection.getBalance(publicKey);
        if (balanceInLamports < totalRequiredLamports) {
          throw new Error(
            `Insufficient SOL: You have ${(balanceInLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ${(totalRequiredLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`
          );
        }

        setStatus('Ensuring wallet connection...');
        console.log('Ensuring wallet connection...');
        await ensureWalletConnected();

        setStatus('Creating token...');
        console.log('Creating token...');
        const mintKeypair = Keypair.generate();
        const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
        const lamports = await connection.getMinimumBalanceForRentExemption(82);
        const totalSupply = BigInt(Math.round(parseFloat(supply) * Math.pow(10, decimals)));

        // Create Associated Token Account (ATA)
        const associatedToken = getAssociatedTokenAddressSync(
          mintKeypair.publicKey,
          publicKey,
          false,
          tokenProgramId
        );

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const blockhashTimestamp = Date.now();

        // Separate fee transfer transaction
        const feeTransaction = new Transaction({
          recentBlockhash: blockhash,
          feePayer: publicKey,
        });
        feeTransaction.add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: FEE_AMOUNT })
        );

        const { signature: feeSignature } = await signAndSend(feeTransaction, { signers: [] });
        await connection.confirmTransaction({ signature: feeSignature, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('Fee transferred:', feeSignature);

        // Token creation transaction
        const tokenTransaction = new Transaction({
          recentBlockhash: blockhash,
          feePayer: publicKey,
        });

        tokenTransaction.add(
          SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: 82,
            lamports,
            programId: tokenProgramId,
          }),
          createInitializeMintInstruction(mintKeypair.publicKey, decimals, publicKey, null, tokenProgramId),
          createAssociatedTokenAccountInstruction(
            publicKey,
            associatedToken,
            publicKey,
            mintKeypair.publicKey,
            tokenProgramId
          ),
          createMintToInstruction(mintKeypair.publicKey, associatedToken, publicKey, totalSupply, [], tokenProgramId)
        );

        if (revokeMint) {
          tokenTransaction.add(
            SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_MINT_FEE }),
            createSetAuthorityInstruction(
              mintKeypair.publicKey,
              publicKey,
              AuthorityType.MintTokens,
              null,
              [],
              tokenProgramId
            )
          );
        }

        if (Date.now() - blockhashTimestamp > BLOCKHASH_EXPIRY_MS) {
          throw new Error('Blockhash expired before transaction submission');
        }

        const { signature } = await signAndSend(tokenTransaction, { signers: [mintKeypair] });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

        // Add metadata using Metaplex SDK
        const metaplex = new Metaplex(connection);
        metaplex.use(walletAdapterIdentity(wallet));
        const { nft } = await metaplex.nfts().create({
          uri: '', // Add IPFS later if needed
          name: tokenName,
          symbol: tokenSymbol,
          sellerFeeBasisPoints: 0,
          tokenOwner: publicKey,
          tokenMint: mintKeypair.publicKey,
          isMutable: true,
        });

        const mintAddr = mintKeypair.publicKey.toBase58();
        setMintAddress(mintAddr);
        setStatus(
          `Token "${tokenName}" created! Mint: ${mintAddr} 🚀 Add liquidity on Raydium (search by name or mint address) or transfer to another wallet.`
        );
        console.log(`Token "${tokenName}" created! Mint: ${mintAddr}`);
        tokenCreated = true;

        if (tokenCreated) {
          const solPrice = await fetchSolPrice();
          const value = solPrice ? 0.05 * solPrice : 0.05;
          const currency = solPrice ? 'USD' : 'SOL';

          if (typeof window !== 'undefined' && window.gtag) {
            window.gtag('event', 'conversion', {
              send_to: 'AW-16974377388/VNtICOap_7MaEKzjgZ4_',
              transaction_id: signature,
              value: value,
              currency: currency,
            });
            console.log('Google Ads conversion tracked:', {
              send_to: 'AW-16974377388/VNtICOap_7MaEKzjgZ4_',
              transaction_id: signature,
              value: value,
              currency: currency,
            });
          } else {
            console.error('Google gtag not available - conversion tracking failed');
            setStatus(
              `Token "${tokenName}" created! Mint: ${mintAddr} 🚀 Tracking failed - check console`
            );
          }
        }

        return;
      } catch (error) {
        attempts++;
        if (error instanceof SendTransactionError) {
          const logs = await error.getLogs(connection);
          console.error('Transaction simulation failed. Logs:', logs);
          setStatus(`Error: Transaction failed - ${error.message}. Logs: ${logs.join(', ')}`);
        } else {
          console.error('Token creation error:', error);
          setStatus(`Error: ${error.message}`);
        }

        if (attempts === maxAttempts) {
          setStatus(`Failed after ${maxAttempts} attempts: ${error.message}`);
          console.log(`Failed after ${maxAttempts} attempts`);
          return;
        }
        setStatus(`Retrying (${attempts}/${maxAttempts})...`);
        console.log(`Retrying (${attempts}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  const transferTokens = async () => {
    if (!walletReady || !connected || !publicKey || !mintAddress || !recipientAddress || !transferAmount || transferAmount <= 0) {
      setStatus('Please connect wallet, select a token, enter a valid recipient address and amount!');
      console.log('Invalid transfer conditions');
      return;
    }

    const signAndSend = await getSignAndSendTransaction();

    try {
      setStatus('Checking SOL balance for transfer...');
      console.log('Checking SOL balance for transfer...');
      const balanceInLamports = await connection.getBalance(publicKey);
      if (balanceInLamports < TRANSFER_FEE) {
        throw new Error(
          `Insufficient SOL for transfer fee: You have ${(balanceInLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ${TRANSFER_FEE / LAMPORTS_PER_SOL} SOL`
        );
      }

      setStatus('Transferring tokens...');
      console.log('Transferring tokens...');
      const mintPublicKey = new PublicKey(mintAddress);
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
      const recipientPublicKey = new PublicKey(recipientAddress);
      const amount = BigInt(Math.round(parseFloat(transferAmount) * Math.pow(10, decimals)));

      // Get sender and recipient ATAs
      const senderATA = getAssociatedTokenAddressSync(mintPublicKey, publicKey, false, tokenProgramId);
      const recipientATA = getAssociatedTokenAddressSync(mintPublicKey, recipientPublicKey, false, tokenProgramId);

      // Check if recipient ATA exists
      const recipientAccount = await connection.getAccountInfo(recipientATA);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      });

      // Create recipient ATA if it doesn't exist
      if (!recipientAccount) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientATA,
            recipientPublicKey,
            mintPublicKey,
            tokenProgramId
          )
        );
      }

      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: TRANSFER_FEE }),
        createTransferInstruction(senderATA, recipientATA, publicKey, amount, [], tokenProgramId)
      );

      const { signature } = await signAndSend(transaction, { signers: [] });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      setStatus(`Transferred ${transferAmount} ${tokenSymbol} to ${recipientAddress}!`);
      console.log(`Transferred ${transferAmount} ${tokenSymbol} to ${recipientAddress}!`);
      setRecipientAddress('');
      setTransferAmount('');
    } catch (error) {
      console.error('Transfer error:', error);
      setStatus(`Error transferring tokens: ${error.message}`);
    }
  };

  const handleRevokeMint = async (e) => {
    const isChecked = e.target.checked;
    setRevokeMint(isChecked);
    if (!isChecked || !mintAddress) return;

    if (!walletReady || !connected || !publicKey) {
      setStatus('Wallet not ready! Please reconnect.');
      setRevokeMint(false);
      return;
    }

    const signAndSend = await getSignAndSendTransaction();

    try {
      setStatus('Revoking mint authority...');
      console.log('Revoking mint authority...');
      const mintPublicKey = new PublicKey(mintAddress);
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      });

      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_MINT_FEE }),
        createSetAuthorityInstruction(
          mintPublicKey,
          publicKey,
          AuthorityType.MintTokens,
          null,
          [],
          tokenProgramId
        )
      );

      const { signature } = await signAndSend(transaction, { signers: [] });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      setStatus('Mint authority revoked!');
      console.log('Mint authority revoked!');
    } catch (error) {
      console.error('Revoke mint error:', error);
      setStatus(`Error revoking mint: ${error.message}`);
      setRevokeMint(false);
    }
  };

  const selectTokenToRevoke = () => {
    if (!connected || !publicKey) {
      setStatus('Connect your wallet to select a token to revoke!');
      console.log('Wallet not connected for revoke selection');
      return;
    }
    setStatus('Please enter a mint address manually (feature coming soon).');
    console.log('Manual mint address entry prompted');
  };

  const revokeExistingMint = async () => {
    if (!walletReady || !connected || !publicKey || !tokenProgramId || !selectedMintAddress) {
      setStatus('Connect wallet and enter a mint address to revoke!');
      console.log('Invalid revoke conditions');
      return;
    }

    const signAndSend = await getSignAndSendTransaction();

    try {
      setStatus('Revoking mint authority for selected token...');
      console.log('Revoking mint authority for selected token...');
      const mintPublicKey = new PublicKey(selectedMintAddress);
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      });

      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_MINT_FEE }),
        createSetAuthorityInstruction(
          mintPublicKey,
          publicKey,
          AuthorityType.MintTokens,
          null,
          [],
          tokenProgramId
        )
      );

      const { signature } = await signAndSend(transaction, { signers: [] });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      setStatus(`Mint authority revoked for ${selectedMintAddress}!`);
      console.log(`Mint authority revoked for ${selectedMintAddress}!`);
      setSelectedMintAddress('');
    } catch (error) {
      console.error('Revoke existing mint error:', error);
      setStatus(`Error: ${error.message}`);
    }
  };

  const handleRevokeFreeze = () => {
    setStatus('Freeze authority is automatically revoked during token creation (included in base fee)!');
    console.log('Freeze authority revocation info displayed');
  };

  const redirectToRaydiumLiquidity = () => {
    const raydiumUrl = 'https://raydium.io/liquidity/';
    window.open(raydiumUrl, '_blank');
    console.log('Redirected to Raydium liquidity');
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoContainer}>
          <img src="/elon-powersaw.png" alt="Elon Musk with Powersaw" className={styles.elonImage} />
          <div className={styles.logo}>Meme Coins Creator</div>
        </div>
        <WalletMultiButtonDynamic className={styles.walletButton}>
          {connected ? null : 'Connect Wallet'}
        </WalletMultiButtonDynamic>
      </header>
      <main className={styles.main}>
        <div className={styles.contentWrapper}>
          <section className={styles.toolsSection}>
            <h1 className={styles.title}>Create Your MemeCoin Today for Just 0.05 SOL!</h1>
            <p className={styles.subtitle}>
              The CHEAPEST & EASIEST way to blast your memecoin to Raydium & Dexscreener instantly!
            </p>
            <div className={styles.tokenCard}>
              <input
                type="text"
                placeholder="Token Name (e.g., DogeKing)"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className={styles.input}
              />
              <input
                type="text"
                placeholder="Symbol (e.g., DGK)"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                className={styles.input}
              />
              <input
                type="number"
                placeholder="Total Supply (e.g., 1000000)"
                value={supply}
                onChange={(e) => setSupply(e.target.value)}
                className={styles.input}
              />
              <input
                type="number"
                placeholder="Decimals (e.g., 6)"
                value={decimals}
                onChange={(e) => setDecimals(e.target.value)}
                className={styles.input}
              />
              <div className={styles.imageUpload}>
                <label htmlFor="token-image">Upload Meme Image (optional)</label>
                <input type="file" id="token-image" accept="image/*" onChange={handleImageChange} />
                {imagePreview && (
                  <div className={styles.imagePreviewContainer}>
                    <img src={imagePreview} alt="Meme Preview" className={styles.imagePreview} />
                    <button onClick={removeImage} className={styles.removeImageButton}>Remove Image</button>
                  </div>
                )}
              </div>
              <div className={styles.buttonGroup}>
                <div className={styles.buttonRow}>
                  <button onClick={createToken} className={styles.createButton}>
                    Launch Memecoin 🚀 (0.05 SOL)
                  </button>
                  <button onClick={redirectToRaydiumLiquidity} className={styles.createButton}>
                    Add Liquidity
                  </button>
                </div>
                <div className={styles.buttonRow}>
                  <label className={styles.switchLabel}>
                    Revoke Mint (0.025 SOL)
                    <input
                      type="checkbox"
                      checked={revokeMint}
                      onChange={handleRevokeMint}
                      className={styles.switchInput}
                    />
                    <span className={styles.slider}></span>
                  </label>
                  <label className={styles.switchLabel}>
                    Revoke Freeze (Included)
                    <input
                      type="checkbox"
                      checked={revokeFreeze}
                      onChange={handleRevokeFreeze}
                      disabled
                      className={styles.switchInput}
                    />
                    <span className={styles.slider}></span>
                  </label>
                </div>
              </div>
              <p className={styles.status}>{status}</p>
            </div>
            <div className={styles.revokeSection}>
              <h2 className={styles.revokeTitle}>Revoke Mint Authority</h2>
              <button onClick={selectTokenToRevoke} className={styles.createButton}>
                Select Token to Revoke
              </button>
              {selectedMintAddress && (
                <div className={styles.selectedToken}>
                  <p>Selected: {selectedMintAddress}</p>
                  <button onClick={revokeExistingMint} className={styles.createButton}>
                    Revoke Mint (0.025 SOL)
                  </button>
                </div>
              )}
            </div>
            <div className={styles.transferSection}>
              <h2 className={styles.revokeTitle}>Transfer Tokens</h2>
              <input
                type="text"
                placeholder="Recipient Wallet Address"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                className={styles.input}
              />
              <input
                type="number"
                placeholder="Amount to Transfer"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                className={styles.input}
              />
              <button onClick={transferTokens} className={styles.createButton}>
                Transfer Tokens (0.001 SOL)
              </button>
            </div>
          </section>
          <aside className={styles.sidebar}>
            <section className={styles.guide}>
              <h2 className={styles.guideTitle}>How to Use Meme Coins Creator</h2>
              <p className={styles.guideText}>
                Launch your Solana memecoin in minutes with the cheapest tool around! Here’s how:
              </p>
              <ol className={styles.guideList}>
                <li><strong>Connect Wallet:</strong> Click "Connect Wallet" and link your Solana wallet (e.g., Phantom) on Mainnet.</li>
                <li><strong>Fill Details:</strong> Enter your token name, symbol, supply, and decimals.</li>
                <li><strong>Upload Image:</strong> Add a meme image (optional, detachable with "Remove Image").</li>
                <li><strong>Launch Token:</strong> Click "Launch Memecoin" (0.05 SOL, includes freeze revocation). Optionally revoke mint for an extra 0.025 SOL.</li>
                <li><strong>Transfer Tokens:</strong> Enter a recipient wallet address and amount, then click "Transfer Tokens" (0.001 SOL) to send tokens without adding liquidity.</li>
                <li><strong>Add Liquidity:</strong> Click "Add Liquidity" to visit Raydium. Search for your token by name, symbol, or mint address (copy from status message) and create a liquidity pool with SOL or USDC.</li>
                <li><strong>Revoke Existing Mint:</strong> Click "Select Token to Revoke," enter a mint address, and revoke for 0.025 SOL.</li>
              </ol>
              <p className={styles.guideText}>
                Your token will be live on Raydium and Dexscreener after adding liquidity! If it doesn’t appear in Raydium’s dropdown, paste the mint address in the search bar.
              </p>
            </section>
            <section className={styles.faq}>
              <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
              <div className={styles.faqList}>
                <div className={styles.faqItem}>
                  <h3>What does it cost to launch a token?</h3>
                  <p>Only 0.05 SOL for creation (includes freeze revocation). Revoking mint adds 0.025 SOL.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>Can I transfer tokens without adding liquidity?</h3>
                  <p>Yes, use the "Transfer Tokens" section to send tokens to another wallet for 0.001 SOL.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>Why is revoke freeze included?</h3>
                  <p>It’s automatically revoked during creation to ensure your token can’t be frozen, enhancing trust.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>How do I revoke mint for an existing token?</h3>
                  <p>Click "Select Token to Revoke," enter your token’s mint address, and confirm for 0.025 SOL.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>Why don’t I see my token on Raydium?</h3>
                  <p>Search for your token by name, symbol, or mint address on Raydium. Ensure you’ve created a liquidity pool. Copy the mint address from the status message if needed.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>What if I encounter an error?</h3>
                  <p>Ensure your wallet has enough SOL (~0.1 SOL for creation + pool or transfers), is on Mainnet, and you’re the token’s authority. Contact <a href="mailto:memecoinscreator2025@gmail.com">support</a> if issues persist.</p>
                </div>
              </div>
            </section>
          </aside>
        </div>
        <section className={styles.features}>
          <h2 className={styles.featureTitle}>Why Meme Coins Creator?</h2>
          <div className={styles.featureGrid}>
            <div className={styles.featureCard}>Cheapest Launch at 0.05 SOL</div>
            <div className={styles.featureCard}>Instant listing on Raydium & Dexscreener</div>
            <div className={styles.featureCard}>No Coding skills required</div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>
          © 2025 Meme Coins Creator - Powered by <a href="https://solana.com" target="_blank">Solana</a>
        </p>
        <p>
          Need help? Contact support at{' '}
          <a href="mailto:memecoinscreator2025@gmail.com" target="_blank" rel="noopener noreferrer">
            memecoinscreator2025@gmail.com
          </a>
        </p>
      </footer>
    </div>
  );
}
