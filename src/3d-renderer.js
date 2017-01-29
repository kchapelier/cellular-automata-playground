"use strict";

var definePhongSSAOMaterial = require('./three/define-phong-ssao-shader');

var OrbitControls = require('./three/orbitcontrol'),
    converToGeometry = require('./utils/convert-to-geometry'),
    EffectComposer = require('./three/effect-composer'),
    pixelRatio = 1; //(typeof window.devicePixelRatio !== 'undefined' ? window.devicePixelRatio : 1);

function ThreeDimensionsRenderer (container, zoom) {
    this.container = container;

    this.width = 100;
    this.height = 100;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, maxLights: 3, transparent: false });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.renderer.autoClear = false;

    definePhongSSAOMaterial(THREE, this.renderer);

    this.camera = new THREE.PerspectiveCamera(70, this.width / this.height, 1, 10000);
    this.scene = new THREE.Scene();

    this.composer = new EffectComposer(this.renderer, this.scene, this.camera, this.width, this.height);

    this.controls = new OrbitControls( this.camera, this.renderer.domElement );
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.875;
    this.controls.enableZoom = true;
    this.controls.enablePan = false;

    this.hemiLight = new THREE.HemisphereLight(0xF0F0F3, 0x384033, 0.1);
    this.scene.add(this.hemiLight);

    this.staticLight = new THREE.PointLight(0xAAAAAA, 0.85, 2000, 1.);
    this.staticLight.position.set(700, 600, 400);
    this.scene.add(this.staticLight);

    this.dynamicLight = new THREE.PointLight(0x999999, 0.5, 1500, 1.3);
    this.dynamicLight.position.set(-600, -400, 800);
    this.scene.add(this.dynamicLight);

    this.scene.add(this.camera);
    this.camera.position.set(500, 500, 500);
    this.camera.lookAt(this.scene.position);

    this.material = new THREE.MeshPhongMaterial({
        color: 0xE0E0E3,
        specular: 0x999999,
        shininess: 0.36,
        wireframe : false,
        aoCameraNear:1.,
        aoCameraFar:10000.,
        aoOnly: false,
        aoClamp: 0.85,
        aoMapIntensity: 0.9,
        aoMap: this.composer.getDepthTexture(),
        aoResolution: new THREE.Vector2(this.width, this.height)
    });

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'three-d';

    // those four lines force the creation of the shader program by making a render
    this.element = new THREE.Mesh(new THREE.BoxBufferGeometry(100, 100, 100), this.material);
    this.scene.add(this.element);
    this.dirty = true;
    this.animationFrame();

    this.container.appendChild(this.canvas);
}

ThreeDimensionsRenderer.prototype.setZoom = function (zoom) {
    // not used in this renderer
};

ThreeDimensionsRenderer.prototype.resizeShape = function (shape) {
    // not used in this renderer
};

ThreeDimensionsRenderer.prototype.resizeWindow = function () {
    var bounds = this.container.getBoundingClientRect();
    this.width = bounds.width;
    this.height = bounds.height;

    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.material.aoResolution.set(this.width, this.height);

    this.dirty = true;
};

ThreeDimensionsRenderer.prototype.show = function () {
    if (!this.canvas.classList.contains('show')) {
        this.canvas.classList.add('show');
        this.resizeWindow();
        this.dirty = true;
    }
};

ThreeDimensionsRenderer.prototype.hide = function () {
    this.canvas.classList.remove('show');
};

ThreeDimensionsRenderer.prototype.displayRawData = function (data) {
    if (this.element) {
        this.scene.remove(this.element);
    }

    var geometry = converToGeometry(data);

    this.element = new THREE.Mesh(
        geometry,
        this.material
    );

    this.element.scale.set(10, 10, 10);

    this.scene.add(this.element);

    this.dirty = true;
};

ThreeDimensionsRenderer.prototype.animationFrame = function () {
    this.controls.update();

    if (this.controls.isDirty() || this.dirty) {
        this.dynamicLight.position.copy(this.camera.position);
        this.composer.render();
        this.dirty = false;
    }
};

module.exports = ThreeDimensionsRenderer;
