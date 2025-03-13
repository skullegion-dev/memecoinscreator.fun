import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { useMemo } from 'react';
import Head from 'next/head'; // Still needed for other head elements if added later
import Script from 'next/script'; // Added for Google Analytics scripts
import '../styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function App({ Component, pageProps }) {
  const network = WalletAdapterNetwork.Mainnet; // Configured for Mainnet
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <>
      <Head>
        {/* Optional: Add meta tags or other head elements here if needed */}
      </Head>
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-LQKVMRNG0J"
        strategy="afterInteractive" // Loads after page is interactive
      />
      <Script
        id="google-analytics" // Unique ID for the inline script
        strategy="afterInteractive" // Loads after page is interactive
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-LQKVMRNG0J');
          `,
        }}
      />
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <Component {...pageProps} />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </>
  );
}