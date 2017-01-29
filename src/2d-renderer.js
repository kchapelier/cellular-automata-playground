"use strict";

function TwoDimensionsRenderer (container, zoom) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'two-d';
    this.canvas.width = 100;
    this.canvas.height = 100;
    this.context = this.canvas.getContext('2d');
    this.setZoom(zoom);
    this.container.appendChild(this.canvas);
}

TwoDimensionsRenderer.prototype.setZoom = function (zoom) {
    this.zoom = zoom;
    this.canvas.style.width = (this.canvas.width * this.zoom) + 'px';
    this.canvas.style.height = (this.canvas.height * this.zoom) + 'px';
};

TwoDimensionsRenderer.prototype.resizeShape = function (shape) {
    this.canvas.width = shape[0];
    this.canvas.height = shape[1];
    this.canvas.style.width = (shape[0] * this.zoom) + 'px';
    this.canvas.style.height = (shape[1] * this.zoom) + 'px';
};

TwoDimensionsRenderer.prototype.resizeWindow = function () {
    //console.log(this.container.getBoundingClientRect());
    //not used in this renderer
};

TwoDimensionsRenderer.prototype.show = function () {
    this.canvas.classList.add('show');
};

TwoDimensionsRenderer.prototype.hide = function () {
    this.canvas.classList.remove('show');
};

TwoDimensionsRenderer.prototype.displayImageData = function (data) {
    var imageData = new ImageData(new Uint8ClampedArray(data), this.canvas.width, this.canvas.height);

    this.context.putImageData(imageData, 0, 0);
};

TwoDimensionsRenderer.prototype.animationFrame = function () {
    //not used in this renderer
};

module.exports = TwoDimensionsRenderer;
