import fs from 'node:fs/promises';
import path from 'node:path';

async function updateTemplates() {
  const exisPkgPath = path.resolve('packages/exis/package.json');
  const templatePath = path.resolve('packages/create-exis/src/templates.ts');

  // Read current exisjs version
  const exisPkg = JSON.parse(await fs.readFile(exisPkgPath, 'utf8'));
  const version = exisPkg.version;

  console.log(`Updating create-exis templates to exisjs version: ^${version}`);

  // Read and replace template string
  let templateCode = await fs.readFile(templatePath, 'utf8');
  templateCode = templateCode.replace(
    /exisjs:\s*['"]\^[^'"]+['"]/g,
    `exisjs: '^${version}'`
  );

  await fs.writeFile(templatePath, templateCode);
  console.log('Successfully updated template version!');
}

updateTemplates().catch(err => {
  console.error(err);
  process.exit(1);
});
