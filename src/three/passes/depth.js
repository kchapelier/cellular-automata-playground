"use strict";

var Pass = require('./pass');

var DepthPass = function ( scene, camera ) {
    Pass.call( this );

    this.scene = scene;
    this.camera = camera;

    // Setup depth pass
    this.depthMaterial = new THREE.MeshDepthMaterial();
    this.depthMaterial.depthPacking = THREE.RGBADepthPacking;
    this.depthMaterial.blending = THREE.NoBlending;
};

DepthPass.prototype = Object.create( Pass.prototype );

DepthPass.prototype = {
    constructor: DepthPass,
    render: function ( renderer, writeBuffer ) {
        this.scene.overrideMaterial = this.depthMaterial;
        renderer.render(this.scene, this.camera, writeBuffer, true);
        this.scene.overrideMaterial = null;
    }
};

module.exports = DepthPass;
