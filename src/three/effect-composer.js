"use strict";

var RenderPass = require('./passes/render'),
    DepthPass = require('./passes/depth');

var EffectComposer = function ( renderer, scene, camera, width, height ) {
    var parameters = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false
    };

    var size = renderer.getSize();

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.generalRenderPass = new RenderPass(scene, camera);
    this.depthPass = new DepthPass(scene, camera);

    var pars = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.depthRenderTarget = new THREE.WebGLRenderTarget( width * 1.5 | 0, height * 1.5 | 0, pars );
};

EffectComposer.prototype = {
    getDepthTexture: function () {
        return this.depthRenderTarget.texture;
    },
    setCamera: function (camera) {
        this.camera = camera;
        this.generalRenderPass.camera = camera;
        this.depthPass.camera = camera;
    },
    applyPass: function (pass, writeBuffer, readBuffers) {
        pass.render(
            this.renderer,
            writeBuffer,
            readBuffers
        );
    },
    render: function ( delta ) {
        // Render depth into depthRenderTarget
        this.applyPass(this.depthPass, this.depthRenderTarget, null);
        this.applyPass(this.generalRenderPass, null, null);
    },
    setSize: function (width, height) {
        this.depthRenderTarget.setSize(width * 1.5 | 0, height * 1.5 | 0);
        //this.skyboxTarget.setSize(width / 3 | 0, height / 2 | 0);
    }
};

module.exports = EffectComposer;
