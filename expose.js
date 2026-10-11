import ngrok from 'ngrok';

const port = process.env.PORT || 5174;

try {
  const url = await ngrok.connect(port);
  console.log('\n════════════════════════════════════════');
  console.log('🌐 PDF Toolkit is now PUBLIC');
  console.log('════════════════════════════════════════');
  console.log(`Public URL: ${url}`);
  console.log(`Local URL:  http://localhost:${port}`);
  console.log('════════════════════════════════════════\n');

  // Keep the tunnel alive
  process.on('SIGINT', async () => {
    await ngrok.disconnect();
    process.exit(0);
  });
} catch (err) {
  console.error('ngrok error:', err);
  process.exit(1);
}
