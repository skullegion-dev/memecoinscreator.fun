import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useMemo } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import '../styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function App({ Component, pageProps }) {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = useMemo(() => 'https://billowing-greatest-sheet.solana-mainnet.quiknode.pro/d5106d1eeedbf27adac9b05e8361605dd9b57255/', []);

  const wallets = useMemo(() => {
    const phantom = new PhantomWalletAdapter();
    phantom.on('connect', () => {
      console.log('Phantom connected:', phantom.publicKey?.toBase58());
    });
    phantom.on('disconnect', () => console.log('Phantom disconnected'));
    phantom.on('error', (error) => console.error('Phantom error:', error));
    return [phantom];
  }, []);

  return (
    <>
      <Head>
        <title>Meme Coins Creator</title>
        <meta name="description" content="Launch Solana meme coins for just 0.05 SOL!" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      {/* Google Analytics */}
      <Script src="https://www.googletagmanager.com/gtag/js?id=G-LQKVMRNG0J" strategy="afterInteractive" />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-LQKVMRNG0J');
          `,
        }}
      />
      {/* Google Ads Tag */}
      <Script src="https://www.googletagmanager.com/gtag/js?id=AW-16974377388" strategy="afterInteractive" />
      <Script
        id="google-ads"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-16974377388');
            function gtag_report_conversion(url) {
              var callback = function () {
                if (typeof(url) != 'undefined') {
                  window.location = url;
                }
              };
              gtag('event', 'conversion', {
                'send_to': 'AW-16974377388/7i_qCP-BwLMaEKzjgZ4_',
                'value': 1.0,
                'currency': 'USD',
                'event_callback': callback
              });
              return false;
            }
          `,
        }}
      />
      {/* Twitter Pixel */}
      <Script
        id="twitter-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
            twq('init','pfa12');
            twq('track','PageView');
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
