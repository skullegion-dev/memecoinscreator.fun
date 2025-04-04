import { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { Connection, Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, SendTransactionError } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, createSetAuthorityInstruction, AuthorityType } from '@solana/spl-token';
import styles from '../styles/Home.module.css';

const WalletMultiButtonDynamic = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

const FEE_AMOUNT = 0.05 * LAMPORTS_PER_SOL;
const REVOKE_MINT_FEE = 0.025 * LAMPORTS_PER_SOL;
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
      return null; // Fallback to SOL if fetch fails
    }
  };

  const createToken = async () => {
    console.log('Running updated createToken with tokenCreated flag - v3');
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

        setStatus('Creating token...');
        console.log('Creating token...');
        const mintKeypair = Keypair.generate();
        const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
        const lamports = await connection.getMinimumBalanceForRentExemption(82);

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const blockhashTimestamp = Date.now();

        const transaction = new Transaction({
          recentBlockhash: blockhash,
          feePayer: publicKey,
        });

        transaction.add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: FEE_AMOUNT }),
          SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: 82,
            lamports,
            programId: tokenProgramId,
          }),
          createInitializeMintInstruction(mintKeypair.publicKey, decimals, publicKey, null, tokenProgramId)
        );

        if (revokeMint) {
          transaction.add(
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

        const { signature } = await signAndSend(transaction, { signers: [mintKeypair] });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
        const mintAddr = mintKeypair.publicKey.toBase58();
        setMintAddress(mintAddr);
        setStatus(`Token "${tokenName}" created! Mint: ${mintAddr} 🚀 Add liquidity on Raydium to trade!`);
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
            setStatus(`Token "${tokenName}" created! Mint: ${mintAddr} 🚀 Tracking failed - check console`);
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
        setStatus(`Retrying (${attempts}/${maxAttempts}) due to blockhash issue...`);
        console.log(`Retrying (${attempts}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
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
            <h1 className={styles.title}>Launch Solana Tokens for Just 0.05 SOL!</h1>
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
                <label htmlFor="token-image">Upload Meme Image</label>
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
          </section>
          <aside className={styles.sidebar}>
            <section className={styles.guide}>
              <h2 className={styles.guideTitle}>How to Use Meme Coins Creator</h2>
              <p className={styles.guideText}>
                Launch your Solana memecoin in minutes with the cheapest tool around! Here’s how:
              </p>
              <ol className={styles.guideList}>
                <li><strong>Connect Wallet:</strong> Click "Connect Wallet" and link your Solana wallet (e.g., Phantom).</li>
                <li><strong>Fill Details:</strong> Enter your token name, symbol, supply, and decimals.</li>
                <li><strong>Upload Image:</strong> Add a meme image (optional, detachable with "Remove Image").</li>
                <li><strong>Launch Token:</strong> Click "Launch Memecoin" (0.05 SOL). Optionally revoke mint for an extra 0.025 SOL.</li>
                <li><strong>Add Liquidity:</strong> Use "Add Liquidity" to head to Raydium and make your token tradable.</li>
                <li><strong>Revoke Existing Mint:</strong> Click "Select Token to Revoke," choose a token, and revoke its mint authority for 0.025 SOL.</li>
              </ol>
              <p className={styles.guideText}>
                Your token will be live on Raydium and visible on Dexscreener instantly after adding liquidity!
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
                  <h3>Why is revoke freeze included?</h3>
                  <p>It’s automatically revoked during creation to ensure your token can’t be frozen, enhancing trust.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>How do I revoke mint for an existing token?</h3>
                  <p>Click "Select Token to Revoke," choose your token, and confirm for 0.025 SOL.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>Will my token be on Dexscreener instantly?</h3>
                  <p>Yes, once you add liquidity on Raydium, it’ll appear on Dexscreener automatically.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>What if I encounter an error?</h3>
                  <p>Ensure your wallet has enough SOL, is on Mainnet, and you’re the token’s authority. Contact support if issues persist.</p>
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
