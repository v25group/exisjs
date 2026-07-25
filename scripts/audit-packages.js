const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// The main root and the 3 core packages
const packages = [
  '.',
  'packages/exis',
  'packages/create-exis',
  'packages/client'
];

console.log('=============================================');
console.log('Starting Dependency & Vulnerability Audit');
console.log('=============================================\n');

let hasErrors = false;

for (const pkg of packages) {
  const pkgPath = path.resolve(__dirname, '..', pkg);
  
  if (!fs.existsSync(pkgPath)) {
    continue;
  }

  const pkgName = pkg === '.' ? 'Root Workspace' : pkg;
  console.log(`\nChecking: ${pkgName} ...`);
  
  try {
    // 1. Run npm audit to check for vulnerabilities
    console.log('   Running npm audit (production dependencies only)...');
    execSync('npm audit --audit-level=moderate --omit=dev', { cwd: pkgPath, stdio: 'pipe' });
    
    // 2. Run npm outdated to check for latest versions
    console.log('   Checking for outdated packages...');
    try {
      execSync('npm outdated', { cwd: pkgPath, stdio: 'ignore' });
      console.log(`   [SUCCESS] ${pkgName} is secure and up to date!`);
    } catch (e) {
      // npm outdated returns exit code 1 if there are outdated packages
      console.log(`   [NOTICE] ${pkgName} has some outdated dependencies. Consider running 'npm update'.`);
    }
    
  } catch (error) {
    // npm audit returns exit code 1 if vulnerabilities are found
    console.error(`\n   [ERROR] Vulnerabilities found in ${pkgName}!`);
    console.error(`      Please run 'npm audit' inside ${pkgPath} to review them.`);
    hasErrors = true;
  }
}

console.log('\n=============================================');
if (hasErrors) {
  console.error('[FAIL] Audit Failed: Vulnerabilities were detected in one or more packages.');
  console.error('Please fix the vulnerabilities before publishing the framework.');
  process.exit(1);
} else {
  console.log('[PASS] Audit Passed: All packages are secure and verified!');
}
