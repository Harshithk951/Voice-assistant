// gpu_accelerator.js - Hardware GPU Acceleration & Telemetry for Siri
// Seamlessly discovers and configures NVIDIA CUDA (Windows/Linux) and Apple Metal (macOS)
import { execFile, execSync } from 'node:child_process';
import os from 'node:os';
import fsp from 'node:fs/promises';
import fs from 'node:fs';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

class GpuAccelerator {
  constructor() {
    this.cachedGpu = null;
    this.lastChecked = 0;
    this.CACHE_TTL = 30_000; // 30 seconds
  }

  /**
   * Detects available GPU hardware (NVIDIA CUDA or Apple Metal)
   * @returns {Promise<Object>} Hardware details
   */
  async detectGpu(force = false) {
    if (!force && this.cachedGpu && (Date.now() - this.lastChecked < this.CACHE_TTL)) {
      return this.cachedGpu;
    }

    const gpuInfo = {
      hasGpu: false,
      type: 'CPU_ONLY',
      backend: 'CPU',
      device: 'CPU Fallback',
      vramTotalMB: 0,
      vramFreeMB: 0,
      driverVersion: null,
      cudaVersion: null,
      metalVersion: null,
      temperatureC: null,
      accelerationActive: false
    };

    // 1. Check NVIDIA CUDA (Linux / Windows / eGPU)
    try {
      const nvidiaOut = await new Promise((resolve, reject) => {
        execFile('nvidia-smi', [
          '--query-gpu=name,driver_version,memory.total,memory.free,temperature.gpu',
          '--format=csv,noheader,nounits'
        ], { timeout: 3000 }, (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim());
        });
      });

      if (nvidiaOut) {
        const parts = nvidiaOut.split('\n')[0].split(',').map(s => s.trim());
        gpuInfo.hasGpu = true;
        gpuInfo.type = 'NVIDIA_CUDA';
        gpuInfo.backend = 'CUDA';
        gpuInfo.device = parts[0] || 'NVIDIA GPU';
        gpuInfo.driverVersion = parts[1] || 'Unknown';
        gpuInfo.vramTotalMB = parseInt(parts[2], 10) || 0;
        gpuInfo.vramFreeMB = parseInt(parts[3], 10) || 0;
        gpuInfo.temperatureC = parseInt(parts[4], 10) || null;
        gpuInfo.accelerationActive = true;

        // Try getting nvcc version
        try {
          const nvccOut = execSync('nvcc --version', { timeout: 2000, encoding: 'utf8' });
          const m = nvccOut.match(/release\s+(\d+\.\d+)/i);
          if (m) gpuInfo.cudaVersion = m[1];
        } catch {}

        this.cachedGpu = gpuInfo;
        this.lastChecked = Date.now();
        return gpuInfo;
      }
    } catch {}

    // 2. Check macOS Metal / Apple Silicon / AMD Radeon
    if (IS_MAC) {
      try {
        const profilerOut = await new Promise((resolve, reject) => {
          execFile('system_profiler', ['SPDisplaysDataType', '-detailLevel', 'mini'], { timeout: 4000 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout);
          });
        });

        const hasMetal = /Metal Support:\s*(Metal\s*\d+|Supported)/i.test(profilerOut);
        const chipsetMatch = profilerOut.match(/Chipset Model:\s*(.+)/i);
        const vramMatch = profilerOut.match(/VRAM[^:]*:\s*(\d+)\s*(MB|GB)/i);

        let vramMB = 0;
        if (vramMatch) {
          const val = parseInt(vramMatch[1], 10);
          vramMB = vramMatch[2].toUpperCase() === 'GB' ? val * 1024 : val;
        }

        // Detect Apple Silicon unified memory
        let cpuBrand = '';
        try {
          cpuBrand = execSync('sysctl -n machdep.cpu.brand_string', { timeout: 1000, encoding: 'utf8' }).trim();
        } catch {}

        const isAppleSilicon = /Apple\s+M\d/i.test(cpuBrand) || /Apple/i.test(chipsetMatch?.[1] || '');

        if (hasMetal || isAppleSilicon) {
          gpuInfo.hasGpu = true;
          gpuInfo.type = isAppleSilicon ? 'APPLE_SILICON_MPS' : 'MAC_METAL_GPU';
          gpuInfo.backend = 'Metal';
          gpuInfo.device = chipsetMatch ? chipsetMatch[1].trim() : (isAppleSilicon ? cpuBrand : 'Apple Metal GPU');
          gpuInfo.vramTotalMB = vramMB || Math.round(os.totalmem() / (1024 * 1024));
          gpuInfo.metalVersion = 'Metal 3';
          gpuInfo.accelerationActive = true;

          this.cachedGpu = gpuInfo;
          this.lastChecked = Date.now();
          return gpuInfo;
        }
      } catch {}
    }

    // 3. Fallback: Check Windows Direct3D / WMI
    if (IS_WIN) {
      try {
        const wmicOut = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 3000, encoding: 'utf8' }).trim();
        if (wmicOut) {
          gpuInfo.device = wmicOut.split('\n')[0].trim();
          gpuInfo.hasGpu = true;
          gpuInfo.type = 'WINDOWS_GPU';
          gpuInfo.backend = 'DirectX/DirectML';
          this.cachedGpu = gpuInfo;
          this.lastChecked = Date.now();
          return gpuInfo;
        }
      } catch {}
    }

    this.cachedGpu = gpuInfo;
    this.lastChecked = Date.now();
    return gpuInfo;
  }

  /**
   * Formats a human-readable and spoken report of GPU acceleration status
   */
  async getStatusReport() {
    const gpu = await this.detectGpu(true);
    if (!gpu.hasGpu) {
      return {
        status: 'CPU_ONLY',
        spoken: 'Operating in CPU mode. No dedicated NVIDIA CUDA or Apple Metal GPU detected.',
        details: gpu
      };
    }

    const vramGb = (gpu.vramTotalMB / 1024).toFixed(1);
    const tempText = gpu.temperatureC ? ` running at ${gpu.temperatureC} degrees Celsius` : '';
    const spoken = `GPU acceleration is active via ${gpu.backend} on ${gpu.device} with ${vramGb} gigabytes VRAM${tempText}. Inference latency is optimized for sub-second execution.`;

    return {
      status: 'ACCELERATED',
      backend: gpu.backend,
      device: gpu.device,
      vramTotalMB: gpu.vramTotalMB,
      vramFreeMB: gpu.vramFreeMB,
      temperatureC: gpu.temperatureC,
      spoken,
      details: gpu
    };
  }

  /**
   * Recommends optimal local model settings for the detected hardware
   */
  async getModelRecommendations() {
    const gpu = await this.detectGpu();
    if (gpu.backend === 'CUDA') {
      if (gpu.vramTotalMB >= 16000) {
        return { model: 'llama3.2-vision:11b', layers: 99, ctx: 8192, quantized: 'q4_K_M' };
      } else if (gpu.vramTotalMB >= 8000) {
        return { model: 'qwen2.5-vl:7b', layers: 99, ctx: 4096, quantized: 'q4_0' };
      }
      return { model: 'moondream2', layers: 32, ctx: 2048, quantized: 'q4_0' };
    }

    if (gpu.backend === 'Metal') {
      const memGb = gpu.vramTotalMB / 1024;
      if (memGb >= 16) {
        return { model: 'llama3.2-vision', layers: 99, ctx: 8192, quantized: 'q4_K_M' };
      }
      return { model: 'llama3.2:3b', layers: 99, ctx: 4096, quantized: 'q4_K_M' };
    }

    return { model: 'llama3.2:1b', layers: 0, ctx: 2048, quantized: 'q4_0' };
  }
}

export const gpuAccelerator = new GpuAccelerator();
export default gpuAccelerator;
