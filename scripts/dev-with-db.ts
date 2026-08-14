import { spawn } from 'child_process';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');

console.log('🚀 Starting local MySQL container via Docker Compose...');

// 1. Start Docker container in background
const dockerUp = spawn('docker', ['compose', 'up', '-d', 'mysql'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
});

dockerUp.on('close', (code) => {
  if (code !== 0) {
    console.error(`❌ Failed to start MySQL container (Exit Code ${code})`);
    process.exit(code || 1);
  }

  console.log('✅ MySQL container started. Launching Fastify app...');

  // 2. Start app with tsx watch
  const appProcess = spawn('npx', ['tsx', 'watch', 'src/app.ts'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  });

  // 3. Helper function to shut down container on exit
  const stopContainerAndExit = (exitCode: number = 0) => {
    console.log('\n🛑 Stopping local MySQL container...');
    const dockerDown = spawn('docker', ['compose', 'stop', 'mysql'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    });

    dockerDown.on('close', () => {
      console.log('✅ MySQL container stopped.');
      process.exit(exitCode);
    });
  };

  // Handle Ctrl+C (SIGINT), SIGTERM, and app exit
  process.on('SIGINT', () => stopContainerAndExit(0));
  process.on('SIGTERM', () => stopContainerAndExit(0));

  appProcess.on('close', (code) => {
    stopContainerAndExit(code || 0);
  });
});
