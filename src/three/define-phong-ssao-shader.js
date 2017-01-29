"use strict";

// The SSAO shader itself is taken and adapted from https://threejs.org/examples/webgl_postprocessing_ssao.html
// courtesy of alteredq

var ssaoShader = `
    // packing stuff, packing is not loaded in basic shader, but is in phong and lambert
    // this means we can't just blindly load the packing ShaderChunk
    const float aoUnpackDownscale = 255. / 256.; // 0..1 -> fraction (excluding 1)
    const vec3 aoPackFactors = vec3( 256. * 256. * 256., 256. * 256.,  256. );
    const vec4 aoUnpackFactors = aoUnpackDownscale / vec4( aoPackFactors, 1. );

    float aoUnpackRGBAToDepth( const in vec4 v ) {
        return dot( v, aoUnpackFactors );
    }

    vec2 aoRand( const in vec2 aoUv ) {
        vec2 noise;
        if ( aoUseNoise ) {
            float nx = dot ( aoUv, vec2( 12.9898, 78.233 ) );
            float ny = dot ( aoUv, vec2( 12.9898, 78.233 ) * 2.0 );
            noise = clamp( fract ( 43758.5453 * sin( vec2( nx, ny ) ) ), 0.0, 1.0 );
        } else {
            float ff = fract( 1.0 - aoUv.s * ( aoResolution.x / 2.0 ) );
            float gg = fract( aoUv.t * ( aoResolution.y / 2.0 ) );
            noise = vec2( 0.25, 0.75 ) * vec2( ff ) + vec2( 0.75, 0.25 ) * gg;
        }
        return ( noise * 2.0  - 1.0 ) * aoNoiseAmount;
    }
    float readDepth( const in vec2 aoUv ) {
        float cameraFarPlusNear = aoCameraFar + aoCameraNear;
        float cameraFarMinusNear = aoCameraFar - aoCameraNear;
        float cameraCoef = 2.0 * aoCameraNear;
    #ifdef USE_LOGDEPTHBUF
        float logz = aoUnpackRGBAToDepth( texture2D( aoMap, aoUv ) );
        float w = pow(2.0, (logz / logDepthBufFC)) - 1.0;
        float z = (logz / w) + 1.0;
    #else
        float z = aoUnpackRGBAToDepth( texture2D( aoMap, aoUv ) );
    #endif
        return cameraCoef / ( cameraFarPlusNear - z * cameraFarMinusNear );
    }
    float compareDepths( const in float depth1, const in float depth2, inout int far ) {
        float garea = 2.0;
        float diff = ( depth1 - depth2 ) * 100.0;
        if ( diff < aoGaussDisplace ) {
            garea = aoDiffArea;
        } else {
            far = 1;
        }
        float dd = diff - aoGaussDisplace;
        float gauss = pow( EULER, -2.0 * dd * dd / ( garea * garea ) );
        return gauss;
    }
    float calcAO( vec2 aoUv, float depth, float dw, float dh ) {
        float dd = aoRadius - depth * aoRadius;
        vec2 vv = vec2( dw, dh );
        vec2 coord1 = aoUv + dd * vv;
        vec2 coord2 = aoUv - dd * vv;
        float temp1 = 0.0;
        float temp2 = 0.0;
        int far = 0;
        temp1 = compareDepths( depth, readDepth( coord1 ), far );
        if ( far > 0 ) {
            temp2 = compareDepths( readDepth( coord2 ), depth, far );
            temp1 += ( 1.0 - temp1 ) * temp2;
        }
        return temp1;
    }

    float sampleAO(vec2 aoUv)
    {
        vec2 noise = aoRand(aoUv);
        float depth = readDepth(aoUv);
        float tt = clamp(depth, aoClamp, 1.0);
        float w = ( 1.0 / aoResolution.x ) / tt + ( noise.x * ( 1.0 - noise.x ) );
        float h = ( 1.0 / aoResolution.y ) / tt + ( noise.y * ( 1.0 - noise.y ) );
        float ao = 0.0;
        float dz = 1.0 / float(aoSamples);
        float z = 1.0 - dz / 2.0;
        float l = 0.0;
        for (int i = 0; i <= aoSamples; i++) {
            float r = sqrt(1.0 - z);
            float pw = cos(l) * r;
            float ph = sin(l) * r;
            ao += calcAO(aoUv, depth, pw * w, ph * h);
            z = z - dz;
            l = l + DL;
        }

        return 1.0 - ao * dz * aoMapIntensity;
    }`;

module.exports = function (THREE, webGlRenderer) {

    var defaultRenderBufferDirect = webGlRenderer.renderBufferDirect;

    webGlRenderer.renderBufferDirect = function (camera, fog, geometry, material, object, group) {
        // this won't work on the first frame because the program is not yet created
        if (material.aoMap && material.program && (
            material.isMeshPhongMaterial ||
            material.isMeshLambertMaterial ||
            material.isMeshBasicMaterial ||
            material.isMeshStandardMaterial ||
            material.isMeshPhysicalMaterial
        )) {
            // bind the program so we can alter its uniforms
            webGlRenderer.context.useProgram(material.program.program);

            var p_uniforms = material.program.getUniforms();
            p_uniforms.map.aoOnly.setValue(webGlRenderer.context, material.aoOnly);
            p_uniforms.map.aoClamp.setValue(webGlRenderer.context, material.aoClamp);
            p_uniforms.map.aoResolution.setValue(webGlRenderer.context, material.aoResolution);
            p_uniforms.map.aoCameraNear.setValue(webGlRenderer.context, material.aoCameraNear);
            p_uniforms.map.aoCameraFar.setValue(webGlRenderer.context, material.aoCameraFar);
        }

        defaultRenderBufferDirect(camera, fog, geometry, material, object, group);
    };

    var prototypePatch = {
        aoResolution: new THREE.Vector2(512, 512),
        aoOnly: false,
        aoClamp: 0.85,
        aoCameraNear: 1.,
        aoCameraFar: 10000.
    };

    Object.assign(THREE.MeshBasicMaterial.prototype, prototypePatch);
    Object.assign(THREE.MeshPhongMaterial.prototype, prototypePatch);
    Object.assign(THREE.MeshLambertMaterial.prototype, prototypePatch);
    Object.assign(THREE.MeshPhysicalMaterial.prototype, prototypePatch);
    Object.assign(THREE.MeshStandardMaterial.prototype, prototypePatch);

    THREE.UniformsLib.aomap = {
        aoOnly: { value: false },
        aoClamp: { value: 0.85 },
        aoCameraNear: { value: 1. },
        aoCameraFar: { value: 10000. },
        aoMap: { value: null },
        aoMapIntensity: { value: 1 },
        aoResolution: { value: new THREE.Vector2(512, 512) }
    };

    THREE.ShaderChunk.aomap_pars_fragment = `
        #ifdef USE_AOMAP
            uniform sampler2D aoMap;
            uniform float aoMapIntensity;
            uniform vec2 aoResolution;
            uniform bool aoOnly;
            uniform float aoClamp;
            uniform float aoCameraNear;
            uniform float aoCameraFar;

            #define DL 2.399963229728653 // PI * ( 3.0 - sqrt( 5.0 ) )
            #define EULER 2.718281828459045

            const int aoSamples = 8; // ao sample count
            const float aoRadius = 4.75; // ao radius
            const bool aoUseNoise = false; // use noise instead of pattern for sample dithering
            const float aoNoiseAmount = 0.0003; // dithering amount
            const float aoDiffArea = 0.45; // self-shadowing reduction
            const float aoGaussDisplace = 0.5; // gauss bell center

            ${ssaoShader}
        #endif`;

    THREE.ShaderChunk.aomap_fragment = `
        #ifdef USE_AOMAP
            vec2 unusedUv = vUv2; //do something with vUv2 to keep the warnings at bay
            float ambientOcclusion = sampleAO(gl_FragCoord.xy / aoResolution.xy);

            // can do some built-in vignetting while we're at it
            //float vignette = smoothstep(0., 1., pow(clamp(1.5 - length(aoUv - 0.5)* 2., 0., 1.), 0.8));

            if (aoOnly) {
                gl_FragColor = vec4(ambientOcclusion, ambientOcclusion, ambientOcclusion, 1.);
                return;
            } else {
                reflectedLight.indirectDiffuse *= ambientOcclusion;
                reflectedLight.directDiffuse *= (0.5 + ambientOcclusion * 0.5);
                reflectedLight.directSpecular *= (0.5 + ambientOcclusion * 0.5);

                #if defined( USE_ENVMAP ) && defined( PHYSICAL )
                    float dotNV = saturate( dot( geometry.normal, geometry.viewDir ) );

                    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.specularRoughness );
                #else
                    reflectedLight.indirectSpecular *= ambientOcclusion;
                #endif
            }
        #endif`;
};
