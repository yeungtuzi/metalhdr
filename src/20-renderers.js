// MetalHDR · renderers — WebGPU（高/低画质）与 WebGL2 回退
(() => {
  "use strict";

  const NS = (globalThis.MetalHDR = globalThis.MetalHDR || {});
  const { WGSL_MAIN, WGSL_DOWN, WGSL_EXT_MAIN, WGSL_EXT_DOWN, WGSL_BLIT, GLSL_VERT, GLSL_FRAG } = NS.shaders;

  const FMT = "rgba16float";
  const U_FLOATS = 20;
  const D_FLOATS = 4;

  const compile = (gl, type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log || "shader compile failed");
    }
    return sh;
  };

  class GpuRenderer {
    constructor(canvas) {
      this.name = "webgpu";
      this.canvas = canvas;
      this.dead = false;
      this.quality = "high";
      this.tone = null;
      this.extended = false;
      this.tex = {};
      this.bind = {};
      this.device = null;
      this.ctx = null;
    }

    static isSupported() {
      return Boolean(navigator.gpu);
    }

    async init(quality, options = {}) {
      this.quality = quality;
      this.allowExt = options.zeroCopy === true;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("no WebGPU adapter");
      this.device = await adapter.requestDevice();
      this.device.lost.then((info) => {
        this.dead = true;
        this.lastError = info?.message || "device lost";
      });

      this.ctx = this.canvas.getContext("webgpu");
      if (!this.ctx) throw new Error("no webgpu context");

      const base = { device: this.device, alphaMode: "opaque", colorSpace: "display-p3" };
      const attempts = [
        { ...base, format: FMT, toneMapping: { mode: "extended" } },
        { ...base, format: FMT },
        { ...base, format: navigator.gpu.getPreferredCanvasFormat() }
      ];
      let lastErr = null;
      for (const cfg of attempts) {
        try {
          this.ctx.configure(cfg);
          this.format = cfg.format;
          this.extended = cfg.format === FMT && Boolean(cfg.toneMapping);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!this.format) throw lastErr || new Error("canvas configure failed");

      this.sampler = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });

      const mainModule = this.device.createShaderModule({ code: WGSL_MAIN });
      const downModule = this.device.createShaderModule({ code: WGSL_DOWN });

      this.mainPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: mainModule, entryPoint: "vs" },
        fragment: { module: mainModule, entryPoint: "fsMain", targets: [{ format: this.format }] }
      });

      this.extPipelines = null;
      if (this.allowExt && typeof this.device.importExternalTexture === "function") {
        try {
          const em = this.device.createShaderModule({ code: WGSL_EXT_MAIN });
          const ed = this.device.createShaderModule({ code: WGSL_EXT_DOWN });
          this.extPipelines = {
            main: this.device.createRenderPipeline({
              layout: "auto",
              vertex: { module: em, entryPoint: "vs" },
              fragment: { module: em, entryPoint: "fsMainExt", targets: [{ format: FMT }] }
            }),
            down: this.device.createRenderPipeline({
              layout: "auto",
              vertex: { module: ed, entryPoint: "vs" },
              fragment: { module: ed, entryPoint: "fsDownExt", targets: [{ format: FMT }] }
            })
          };
          const bm = this.device.createShaderModule({ code: WGSL_BLIT });
          this.extPipelines.blit = this.device.createRenderPipeline({
            layout: "auto",
            vertex: { module: bm, entryPoint: "vs" },
            fragment: { module: bm, entryPoint: "fsBlit", targets: [{ format: this.format }] }
          });
          this.extDownUniform = this.device.createBuffer({
            size: D_FLOATS * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
          });
        } catch (e) {
          this.extPipelines = null;
        }
      }
      this.useExt = this.allowExt && Boolean(this.extPipelines);

      this.downPipeline = this.device.createRenderPipeline({
        layout: "auto",
        vertex: { module: downModule, entryPoint: "vs" },
        fragment: { module: downModule, entryPoint: "fsDown", targets: [{ format: FMT }] }
      });

      this.uniform = this.device.createBuffer({
        size: U_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.downUniform = [0, 1, 2].map(() =>
        this.device.createBuffer({
          size: D_FLOATS * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        })
      );
      this.uData = new Float32Array(U_FLOATS);
      this.dData = new Float32Array(D_FLOATS);

      // 低画质时给小图绑定一个 1×1 占位，避免空绑定
      this.dummy = this.device.createTexture({
        size: [1, 1, 1],
        format: FMT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.device.queue.writeTexture(
        { texture: this.dummy },
        new Float32Array([0, 0, 0, 1]),
        { bytesPerRow: 8 },
        [1, 1, 1]
      );
    }

    // 画布输出尺寸；源纹理始终按视频原尺寸，避免 copyExternalImageToTexture 裁切
    resize(w, h) {
      if (!this.device) return;
      this.outW = Math.max(1, w);
      this.outH = Math.max(1, h);
    }

    allocSource(w, h) {
      const mk = (width, height, extra) =>
        this.device.createTexture({
          size: [Math.max(1, width), Math.max(1, height), 1],
          format: FMT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | extra
        });

      this.destroyTextures();
      this.srcW = Math.max(1, w);
      this.srcH = Math.max(1, h);

      // 高光图只在零拷贝路径使用；拷贝路径没有 extPipelines，不能碰
      if (this.useExt) {
        this.smallW = Math.max(2, this.srcW >> 3);
        this.smallH = Math.max(2, this.srcH >> 3);
        this.tex.small = mk(this.smallW, this.smallH, GPUTextureUsage.RENDER_ATTACHMENT);
        this.dData[0] = this.smallW;
        this.dData[1] = this.smallH;
        this.dData[2] = 1 / this.smallW;
        this.dData[3] = 1 / this.smallH;
        this.device.queue.writeBuffer(this.extDownUniform, 0, this.dData);
        this.bind.extDown = this.device.createBindGroup({
          layout: this.extPipelines.down.getBindGroupLayout(0),
          entries: [
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: this.extDownUniform } }
          ]
        });
        this.bind.extMain = null;
        this.tex.off = mk(this.outW, this.outH, GPUTextureUsage.RENDER_ATTACHMENT);
        this.bind.blit = this.device.createBindGroup({
          layout: this.extPipelines.blit.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.tex.off.createView() },
            { binding: 1, resource: this.sampler }
          ]
        });
        return;
      }

      this.tex.src = mk(this.srcW, this.srcH, GPUTextureUsage.RENDER_ATTACHMENT);

      this.tex.mips = [];
      this.bind.down = [];
      let cw = this.srcW;
      let ch = this.srcH;
      for (let i = 0; i < 3; i++) {
        const nw = Math.max(1, cw >> 1);
        const nh = Math.max(1, ch >> 1);
        if (nw < 2 || nh < 2) break;
        const t = mk(nw, nh, GPUTextureUsage.RENDER_ATTACHMENT);
        this.tex.mips.push(t);
        const prev = i === 0 ? this.tex.src : this.tex.mips[i - 1];
        this.dData[0] = nw;
        this.dData[1] = nh;
        this.dData[2] = 1 / cw;
        this.dData[3] = 1 / ch;
        this.device.queue.writeBuffer(this.downUniform[i], 0, this.dData);
        this.bind.down.push(
          this.device.createBindGroup({
            layout: this.downPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: prev.createView() },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: this.downUniform[i] } }
            ]
          })
        );
        cw = nw;
        ch = nh;
      }
      this.smallView = (this.tex.mips[this.tex.mips.length - 1] || this.dummy).createView();
      this.bind.main = null;
    }

    destroyTextures() {
      if (this.tex.src) this.tex.src.destroy();
      if (this.tex.small) this.tex.small.destroy();
      if (this.tex.off) this.tex.off.destroy();
      (this.tex.mips || []).forEach((t) => t.destroy());
      this.tex = {};
      this.bind = {};
    }

    updateSettings(tone) {
      this.tone = tone;
    }

    writeUniforms() {
      if (!this.device || !this.tone) return;
      const t = this.tone;
      const d = this.uData;
      d[0] = this.outW || this.canvas.width || 1;
      d[1] = this.outH || this.canvas.height || 1;
      d[2] = 1 / Math.max(1, this.srcW || 1);
      d[3] = 1 / Math.max(1, this.srcH || 1);
      d[4] = t.peak;
      d[5] = t.strength;
      d[6] = t.reach;
      d[7] = t.shaping;
      d[8] = t.saturation;
      d[9] = t.sharpen;
      d[10] = t.deband;
      d[11] = t.protect;
      d[12] = t.quality;
      d[13] = t.exposure;
      d[14] = this.extended ? 1 : 0;
      d[15] = 1;
      this.device.queue.writeBuffer(this.uniform, 0, d);
    }

    setQuality(q) {
      this.quality = q;
      this.bind.main = null;
    }

    ensureMainBind() {
      if (this.bind.main) return this.bind.main;
      const small = this.quality === "high" && this.tex.mips.length ? this.smallView : this.dummy.createView();
      this.bind.main = this.device.createBindGroup({
        layout: this.mainPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.tex.src.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.uniform } },
          { binding: 3, resource: small }
        ]
      });
      return this.bind.main;
    }

    render(video) {
      if (this.dead || !this.tone) return;
      if (this.srcW !== video.videoWidth || this.srcH !== video.videoHeight) {
        this.allocSource(video.videoWidth, video.videoHeight);
        this.bind.main = null;
      }
      this.writeUniforms();
      const enc = this.device.createCommandEncoder();

      if (this.useExt) {
        let extTexture = null;
        try {
          extTexture = this.device.importExternalTexture({ source: video });
        } catch {
          this.useExt = false;
          this.tex.small?.destroy();
          this.tex.small = null;
          this.allocSource(video.videoWidth, video.videoHeight);
        }

        if (extTexture) {
          // 高光图：直接从视频纹理降采样，省掉全帧拷贝
          if (this.quality === "high") {
            const downBg = this.device.createBindGroup({
              layout: this.extPipelines.down.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: extTexture },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: { buffer: this.extDownUniform } }
              ]
            });
            const dp = enc.beginRenderPass({
              colorAttachments: [{
                view: this.tex.small.createView(),
                loadOp: "clear", storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 }
              }]
            });
            dp.setPipeline(this.extPipelines.down);
            dp.setBindGroup(0, downBg);
            dp.draw(3);
            dp.end();
          }

          const small = this.quality === "high" ? this.tex.small.createView() : this.dummy.createView();
          const bg = this.device.createBindGroup({
            layout: this.extPipelines.main.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: extTexture },
              { binding: 1, resource: this.sampler },
              { binding: 2, resource: { buffer: this.uniform } },
              { binding: 3, resource: small }
            ]
          });
          const mid = enc.beginRenderPass({
            colorAttachments: [{
              view: this.tex.off.createView(),
              loadOp: "clear", storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }]
          });
          mid.setPipeline(this.extPipelines.main);
          mid.setBindGroup(0, bg);
          mid.draw(3);
          mid.end();

          const blit = enc.beginRenderPass({
            colorAttachments: [{
              view: this.ctx.getCurrentTexture().createView(),
              loadOp: "clear", storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 1 }
            }]
          });
          blit.setPipeline(this.extPipelines.blit);
          blit.setBindGroup(0, this.bind.blit);
          blit.draw(3);
          blit.end();
          this.device.queue.submit([enc.finish()]);
          return;
        }
      }

      if (!this.tex.src) return;
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: this.tex.src },
        [this.srcW, this.srcH, 1]
      );

      if (this.quality === "high") {
        for (let i = 0; i < this.tex.mips.length; i++) {
          const p = enc.beginRenderPass({
            colorAttachments: [
              {
                view: this.tex.mips[i].createView(),
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 1 }
              }
            ]
          });
          p.setPipeline(this.downPipeline);
          p.setBindGroup(0, this.bind.down[i]);
          p.draw(3);
          p.end();
        }
      }

      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: this.ctx.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
          }
        ]
      });
      pass.setPipeline(this.mainPipeline);
      pass.setBindGroup(0, this.ensureMainBind());
      pass.draw(3);
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }

    destroy() {
      try {
        this.destroyTextures();
        this.ctx?.unconfigure?.();
      } catch {
        /* ignore */
      }
    }
  }

  class GlRenderer {
    constructor(canvas) {
      this.name = "webgl";
      this.canvas = canvas;
      this.gl = null;
      this.program = null;
      this.texture = null;
      this.uniforms = {};
      this.tone = null;
    }

    static isSupported() {
      try {
        return Boolean(document.createElement("canvas").getContext("webgl2"));
      } catch {
        return false;
      }
    }

    async init() {
      const gl = this.canvas.getContext("webgl2", {
        alpha: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        desynchronized: true
      });
      if (!gl) throw new Error("no webgl2");
      this.gl = gl;

      const vs = compile(gl, gl.VERTEX_SHADER, GLSL_VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, GLSL_FRAG);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || "link failed");
      }
      this.program = prog;

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      for (const n of [
        "uTex", "uRes", "uTexel", "uPeak", "uStrength", "uReach", "uShaping",
        "uSaturation", "uDeband", "uProtect", "uQuality", "uExposure", "uExtended"
      ]) {
        this.uniforms[n] = gl.getUniformLocation(prog, n);
      }
    }

    resize(w, h) {
      this.gl?.viewport(0, 0, w, h);
    }

    updateSettings(tone) {
      this.tone = tone;
    }

    setQuality() {
      /* GLSL 路径固定低画质 */
    }

    render(video) {
      const gl = this.gl;
      if (!gl || !this.tone) return;
      const tone = this.tone;
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

      gl.uniform1i(this.uniforms.uTex, 0);
      gl.uniform2f(this.uniforms.uRes, video.videoWidth, video.videoHeight);
      gl.uniform2f(this.uniforms.uTexel, 1 / video.videoWidth, 1 / video.videoHeight);
      gl.uniform1f(this.uniforms.uPeak, tone.peak);
      gl.uniform1f(this.uniforms.uStrength, tone.strength);
      gl.uniform1f(this.uniforms.uReach, tone.reach);
      gl.uniform1f(this.uniforms.uShaping, tone.shaping);
      gl.uniform1f(this.uniforms.uSaturation, tone.saturation);
      gl.uniform1f(this.uniforms.uDeband, tone.deband);
      gl.uniform1f(this.uniforms.uProtect, tone.protect);
      gl.uniform1f(this.uniforms.uQuality, tone.quality);
      gl.uniform1f(this.uniforms.uExposure, tone.exposure);
      gl.uniform1f(this.uniforms.uExtended, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    destroy() {
      if (!this.gl) return;
      this.gl.deleteTexture(this.texture);
      this.gl.deleteProgram(this.program);
      this.texture = null;
      this.program = null;
    }
  }

  NS.renderers = { GpuRenderer, GlRenderer };
})();
