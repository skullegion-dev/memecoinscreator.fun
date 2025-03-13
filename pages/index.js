import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { Connection, Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createInitializeMintInstruction, createSetAuthorityInstruction, AuthorityType } from '@solana/spl-token';
import styles from '../styles/Home.module.css';

const WalletMultiButtonDynamic = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

const FEE_AMOUNT = 0.05 * 10 ** 9; // 0.05 SOL for token creation
const REVOKE_FEE_AMOUNT = 0.025 * 10 ** 9; // 0.025 SOL for revoke actions
const FEE_RECIPIENT_ADDRESS = '4b3Dkfw9sdCbYRv68j3Nd3MBT8vNDTpciJTeZHCNkRBm';

export default function Home() {
  const { publicKey, sendTransaction, connected } = useWallet();
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [supply, setSupply] = useState('');
  const [decimals, setDecimals] = useState(6);
  const [status, setStatus] = useState('');
  const [tokenProgramId, setTokenProgramId] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [mintAddress, setMintAddress] = useState(null);
  const [revokeMint, setRevokeMint] = useState(false);
  const [revokeFreeze, setRevokeFreeze] = useState(true);
  const [selectedMintAddress, setSelectedMintAddress] = useState('');

  const connection = new Connection(
    'https://billowing-greatest-sheet.solana-mainnet.quiknode.pro/d5106d1eeedbf27adac9b05e8361605dd9b57255/',
    'confirmed'
  );

  useEffect(() => {
    try {
      const id = new PublicKey(TOKEN_PROGRAM_ID);
      setTokenProgramId(id);
    } catch (error) {
      console.error('Failed to set TOKEN_PROGRAM_ID:', error);
      setStatus(`Error initializing program: ${error.message}`);
    }
  }, []);

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

  const createToken = async () => {
    if (!connected || !publicKey || !sendTransaction || !tokenProgramId) {
      setStatus('Connect your wallet to Mainnet and blast off for just 0.05 SOL!');
      return;
    }
    try {
      setStatus('Checking SOL balance...');
      let totalRequiredLamports = FEE_AMOUNT + REVOKE_FEE_AMOUNT;
      if (revokeMint) {
        totalRequiredLamports += REVOKE_FEE_AMOUNT;
      }
      const totalRequiredSOL = totalRequiredLamports / LAMPORTS_PER_SOL;
      const balanceInLamports = await connection.getBalance(publicKey);
      const balanceInSOL = balanceInLamports / LAMPORTS_PER_SOL;
      if (balanceInLamports < totalRequiredLamports) {
        throw new Error(
          `Insufficient SOL: You have ${balanceInSOL.toFixed(4)} SOL, but ${totalRequiredSOL.toFixed(
            4
          )} SOL is required for token creation${revokeMint ? ' and revoke mint' : ''}.`
        );
      }
      setStatus('Launching the cheapest Solana token straight to Raydium for 0.05 SOL...');
      const mintKeypair = Keypair.generate();
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
      let lamports = await connection.getMinimumBalanceForRentExemption(82);
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: FEE_AMOUNT })
      );
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: 82,
          lamports,
          programId: tokenProgramId,
        })
      );
      transaction.add(
        createInitializeMintInstruction(mintKeypair.publicKey, decimals, publicKey, null, tokenProgramId)
      );
      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_FEE_AMOUNT })
      );
      transaction.add(
        createSetAuthorityInstruction(
          mintKeypair.publicKey,
          publicKey,
          AuthorityType.FreezeAccount,
          null,
          [],
          tokenProgramId
        )
      );
      if (revokeMint) {
        transaction.add(
          SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_FEE_AMOUNT })
        );
        transaction.add(
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
      const signature = await sendTransaction(transaction, connection, { signers: [mintKeypair] });
      await connection.confirmTransaction(signature, 'confirmed');
      const mintAddr = mintKeypair.publicKey.toBase58();
      setMintAddress(mintAddr);
      setStatus(
        `Token launched for 0.05 SOL + 0.025 SOL revoke freeze${
          revokeMint ? ' + 0.025 SOL revoke mint' : ''
        }! Live on Raydium & Dexscreener NOW: ${mintAddr} - To the MOON! 🚀`
      );
    } catch (error) {
      console.error('Token creation error:', error);
      setStatus(`Error: ${error.message} - Retry the cheapest launch ever for 0.05 SOL!`);
    }
  };

  const handleRevokeMint = async (e) => {
    const isChecked = e.target.checked;
    setRevokeMint(isChecked);
    if (!isChecked || !mintAddress) return;
    if (!connected || !publicKey || !sendTransaction) {
      setStatus('Reconnect wallet to revoke mint for just 0.025 SOL!');
      setRevokeMint(false);
      return;
    }
    try {
      setStatus('Revoking mint authority (0.025 SOL fee)...');
      const mintPublicKey = new PublicKey(mintAddress);
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_FEE_AMOUNT })
      );
      transaction.add(
        createSetAuthorityInstruction(mintPublicKey, publicKey, AuthorityType.MintTokens, null, [], tokenProgramId)
      );
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      setStatus('Mint authority revoked - Locked and loaded for the cheapest hype!');
    } catch (error) {
      console.error('Revoke mint error:', error);
      setStatus(`Error revoking mint: ${error.message}`);
      setRevokeMint(false);
    }
  };

  const selectTokenToRevoke = () => {
    if (!connected || !publicKey) {
      setStatus('Connect your wallet to select a token to revoke!');
      return;
    }
    setStatus('Please select a token from your wallet.');
  };

  const revokeExistingMint = async () => {
    if (!connected || !publicKey || !sendTransaction || !tokenProgramId) {
      setStatus('Connect your wallet to revoke mint for an existing token (0.025 SOL)!');
      return;
    }
    if (!selectedMintAddress) {
      setStatus('Please select a token to revoke its mint authority!');
      return;
    }
    try {
      setStatus('Revoking mint authority for selected token (0.025 SOL fee)...');
      const mintPublicKey = new PublicKey(selectedMintAddress);
      const feeRecipient = new PublicKey(FEE_RECIPIENT_ADDRESS);
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: feeRecipient, lamports: REVOKE_FEE_AMOUNT })
      );
      transaction.add(
        createSetAuthorityInstruction(mintPublicKey, publicKey, AuthorityType.MintTokens, null, [], tokenProgramId)
      );
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, 'confirmed');
      setStatus(`Mint authority revoked for ${selectedMintAddress} - Secured for just 0.025 SOL!`);
      setSelectedMintAddress('');
    } catch (error) {
      console.error('Revoke existing mint error:', error);
      setStatus(`Error revoking mint for selected token: ${error.message}`);
    }
  };

  const handleRevokeFreeze = async (e) => {
    setStatus('Revoke freeze is mandatory and already applied during token launch for 0.025 SOL!');
    setRevokeFreeze(true);
  };

  const redirectToRaydiumLiquidity = () => {
    const raydiumUrl = 'https://raydium.io/liquidity/';
    window.open(raydiumUrl, '_blank');
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logoContainer}>
          <img src="/elon-powersaw.png" alt="Elon Musk with Powersaw" className={styles.elonImage} />
          <div className={styles.logo}>Memecoins Creator</div>
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
                    Create Liquidity Pool
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
                    Revoke Freeze 0.025 SOL (Required)
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
              <h2 className={styles.guideTitle}>How to Use Memecoins Creator</h2>
              <p className={styles.guideText}>
                Launch your Solana memecoin in minutes with the cheapest tool around! Here’s how:
              </p>
              <ol className={styles.guideList}>
                <li>
                  <strong>Connect Wallet:</strong> Click "Connect Wallet" and link your Solana wallet (e.g.,
                  Phantom).
                </li>
                <li>
                  <strong>Fill Details:</strong> Enter your token name, symbol, supply, and decimals.
                </li>
                <li>
                  <strong>Upload Image:</strong> Add a meme image (optional, detachable with "Remove Image").
                </li>
                <li>
                  <strong>Launch Token:</strong> Click "Launch Memecoin" (0.05 SOL). Optionally revoke mint for
                  an extra 0.025 SOL.
                </li>
                <li>
                  <strong>Add Liquidity:</strong> Use "Create Liquidity Pool" to head to Raydium and make your
                  token tradable.
                </li>
                <li>
                  <strong>Revoke Existing Mint:</strong> Click "Select Token to Revoke," choose a token, and
                  revoke its mint authority for 0.025 SOL.
                </li>
              </ol>
              <p className={styles.guideText}>
                Your token will be live on Raydium and visible on Dexscreener instantly after adding
                liquidity!
              </p>
            </section>
            <section className={styles.faq}>
              <h2 className={styles.faqTitle}>Frequently Asked Questions</h2>
              <div className={styles.faqList}>
                <div className={styles.faqItem}>
                  <h3>What does it cost to launch a token?</h3>
                  <p>Only 0.05 SOL for creation. Revoking mint adds 0.025 SOL.</p>
                </div>
                <div className={styles.faqItem}>
                  <h3>Why is revoke freeze mandatory?</h3>
                  <p>It ensures your token can’t be frozen later, enhancing trust and security for traders.</p>
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
                  <p>
                    Ensure your wallet has enough SOL, is on Mainnet, and you’re the token’s authority.
                    Contact support if issues persist.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </div>
        <section className={styles.features}>
          <h2 className={styles.featureTitle}>Why Memecoins Creator?</h2>
          <div className={styles.featureGrid}>
            <div className={styles.featureCard}>Cheapest Launch at 0.05 SOL</div>
            <div className={styles.featureCard}>Instant listing on Raydium & Dexscreener</div>
            <div className={styles.featureCard}>No Coding skills required</div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>
          © 2025 Memecoins Creator - Powered by <a href="https://solana.com" target="_blank">Solana</a>
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