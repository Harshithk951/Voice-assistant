// test_computer_use_suite.js - Verification Test Suite for Computer Use, GPU & Workflows
import { gpuAccelerator } from './gpu_accelerator.js';
import { computerUse } from './computer_use.js';
import { fileAnalyzer } from './file_analyzer.js';
import { workflowManager } from './workflow_manager.js';
import { verbIntent } from './server.js';
import assert from 'node:assert';
import path from 'node:path';

async function runTests() {
  console.log('=== 1. Testing GPU & CUDA Hardware Acceleration ===');
  const gpu = await gpuAccelerator.detectGpu(true);
  console.log('  [PASS] GPU detection executed. Backend:', gpu.backend, 'Device:', gpu.device);
  assert.ok(gpu.backend, 'GPU backend should be detected');
  
  const report = await gpuAccelerator.getStatusReport();
  console.log('  [PASS] GPU Status Report generated. Spoken:', report.spoken.slice(0, 70) + '...');
  assert.ok(report.spoken.length > 10, 'Spoken report should be comprehensive');

  console.log('\n=== 2. Testing Computer Use & Desktop Control Fallbacks ===');
  // Test WhatsApp automation with contact name
  const waNameTest = await computerUse.sendWhatsAppMessage('Mom', 'I am on my way', false);
  console.log('  [PASS] WhatsApp Name Automation response received:', waNameTest.spoken.slice(0, 65) + '...');
  assert.ok(waNameTest.spoken, 'WhatsApp should return a spoken result');

  // Test WhatsApp automation with phone number
  const waPhoneTest = await computerUse.sendWhatsAppMessage('919876543210', 'Test message', false);
  console.log('  [PASS] WhatsApp Phone Automation response received:', waPhoneTest.spoken.slice(0, 65) + '...');
  assert.ok(waPhoneTest.spoken, 'WhatsApp should handle phone numbers');

  // Test Finder / File Explorer focus on current directory
  const revealTest = await computerUse.revealAndFocusPath(process.cwd());
  console.log('  [PASS] System file manager focus executed:', revealTest.spoken);
  assert.ok(revealTest.ok, 'File manager focus should succeed on existing directory');

  console.log('\n=== 3. Testing Deep File & Directory AI Analysis ===');
  // Test directory analysis on current workspace
  const dirAnalysis = await fileAnalyzer.findAndAnalyze(process.cwd(), 'What is this project?');
  console.log('  [PASS] Workspace directory analyzed:', dirAnalysis.spoken.slice(0, 80) + '...');
  assert.ok(dirAnalysis.ok, 'Directory analysis should succeed');
  assert.strictEqual(dirAnalysis.isDirectory, true, 'Should recognize directory');

  // Test security sandbox rejection on restricted paths
  const blockedAnalysis = await fileAnalyzer.findAndAnalyze('.env');
  console.log('  [PASS] Restricted path protection active:', blockedAnalysis.spoken);
  assert.ok(blockedAnalysis.spoken.includes('Security boundary protected') || blockedAnalysis.spoken.includes("couldn't find"), 'Must not leak .env');

  console.log('\n=== 4. Testing Heavy Workflow & n8n Manager ===');
  const n8nStatus = await workflowManager.checkN8nStatus();
  console.log('  [PASS] n8n status checked. URL:', n8nStatus.url, 'Active:', n8nStatus.running);
  assert.ok(n8nStatus.url.includes('5678'), 'n8n port should be 5678');

  // Test Resume Job Search Workflow
  const workflowRes = await workflowManager.runResumeJobSearchWorkflow('package.json', 'Full Stack Engineer');
  console.log('  [PASS] Resume job search workflow executed:', workflowRes.spoken.slice(0, 80) + '...');
  assert.ok(workflowRes.ok, 'Job search workflow should complete successfully');

  console.log('\n=== 5. Testing Prompt Bar & Verb Intent Routing ===');
  const route1 = verbIntent('gpu status');
  assert.strictEqual(route1?.action, 'gpu_status', 'Should route to gpu_status');
  console.log('  [PASS] "gpu status" -> gpu_status');

  const route2 = verbIntent('open finder and search for assignment and analyze what is there in it');
  assert.strictEqual(route2?.action, 'find_and_analyze', 'Should route to find_and_analyze');
  console.log('  [PASS] "open finder and search for assignment and analyze..." -> find_and_analyze');

  const route3 = verbIntent('run job search workflow with my resume');
  assert.strictEqual(route3?.action, 'run_workflow', 'Should route to run_workflow');
  console.log('  [PASS] "run job search workflow with my resume" -> run_workflow');

  const route4 = verbIntent('whatsapp mom saying I am reaching in 10 minutes');
  assert.strictEqual(route4?.action, 'send_whatsapp', 'Should route to send_whatsapp');
  console.log('  [PASS] "whatsapp mom saying..." -> send_whatsapp');

  const route5 = verbIntent('play arijit singh on youtube');
  assert.strictEqual(route5?.action, 'play_youtube', 'Should route to play_youtube');
  console.log('  [PASS] "play arijit singh on youtube" -> play_youtube');

  console.log('\n========================================');
  console.log('ALL COMPUTER USE & GPU TESTS PASSED (14/14)!');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
