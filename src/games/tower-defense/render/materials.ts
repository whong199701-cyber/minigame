/**
 * Shared materials. Models carry albedo in `color` and glow in `aEmissive` vertex attributes; instanced meshes add
 * per-instance FX vectors (`iFx`, `iFx2`) read by patched MeshStandardMaterial shaders, so infection, hit flashes,
 * dissolves, stealth and selection never need a material swap (one program per material kind).
 */
import { Color, MeshLambertMaterial, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';

export interface SharedUniforms {
  uTime: { value: number };
  uFever: { value: number };
  uAdrenaline: { value: number };
  uRim: { value: Color };
  uRimStrength: { value: number };
  uInfect: { value: Color };
  uSelect: { value: Color };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uFever: { value: 0 },
    uAdrenaline: { value: 0 },
    uRim: { value: new Color(0xff9ec8) },
    uRimStrength: { value: 0.35 },
    uInfect: { value: new Color(0x9ee62a) },
    uSelect: { value: new Color(0xffffff) },
  };
}

export type CellKind = 'static' | 'tower' | 'enemy' | 'hero';

const COMMON_VERT = /* glsl */ `
attribute vec3 aEmissive;
varying vec3 vEmissive;
varying vec3 vObjPos;
varying vec4 vFx;
varying vec4 vFx2;
#ifdef USE_INSTANCING
attribute vec4 iFx;
attribute vec4 iFx2;
#endif
uniform float uTime;
uniform float uFever;
`;

const COMMON_FRAG = /* glsl */ `
varying vec3 vEmissive;
varying vec3 vObjPos;
varying vec4 vFx;
varying vec4 vFx2;
uniform float uTime;
uniform float uFever;
uniform float uAdrenaline;
uniform vec3 uRim;
uniform float uRimStrength;
uniform vec3 uInfect;
uniform vec3 uSelect;
float tdHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float tdIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

function patch(kind: CellKind) {
  return (shader: WebGLProgramParametersWithUniforms, u: SharedUniforms): void => {
    Object.assign(shader.uniforms, u);
    let v = shader.vertexShader;
    v = v.replace('#include <common>', '#include <common>\n' + COMMON_VERT);
    let fxAssign = '#ifdef USE_INSTANCING\n vFx = iFx; vFx2 = iFx2;\n#else\n vFx = vec4(0.0, 0.0, 1.0, 0.0); vFx2 = vec4(0.0);\n#endif\n';
    if (kind === 'static' || kind === 'hero') fxAssign = 'vFx = vec4(0.0, 0.0, 1.0, 0.0); vFx2 = vec4(0.0);\n';
    let wobble = '';
    if (kind === 'enemy') {
      // fever shimmer: pathogen membranes ripple while the fever ability is active
      wobble = 'transformed += objectNormal * sin(uTime * 17.0 + position.y * 9.0 + position.x * 7.0) * 0.07 * uFever;\n';
    }
    if (kind === 'tower') {
      // infected towers wobble sickly
      wobble = 'transformed += objectNormal * sin(uTime * 9.0 + position.y * 14.0) * 0.012 * vFx.y;\n';
    }
    v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissive = aEmissive;\nvObjPos = position;\n' + fxAssign + wobble);
    shader.vertexShader = v;

    let f = shader.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + COMMON_FRAG);
    let colorMod = '';
    let emissiveMod = 'totalEmissiveRadiance += vEmissive;\n';
    const rim = 'float tdRim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);\n';
    if (kind === 'tower') {
      // vFx: x flash (fire), y infected, z buffed, w selected ; vFx2: x charge, y digesting, z damage (barrier), w immune
      colorMod = `
        float tdInf = vFx.y * (0.55 + 0.15 * sin(uTime * 6.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, uInfect * 0.75, tdInf);
        diffuseColor.rgb *= 1.0 - vFx2.z * 0.45;
      `;
      emissiveMod = `
        ${rim}
        float tdPulse = 0.5 + 0.5 * sin(uTime * 7.0);
        totalEmissiveRadiance += vEmissive * (1.0 + vFx.x * 2.2 + uAdrenaline * (0.6 + 0.9 * tdPulse) + vFx2.x * 0.5 - vFx.y * 0.4);
        totalEmissiveRadiance += uRim * tdRim * uRimStrength;
        totalEmissiveRadiance += vec3(1.0, 0.85, 0.4) * tdRim * vFx.z * 0.35;
        totalEmissiveRadiance += uSelect * tdRim * vFx.w * (0.5 + 0.3 * tdPulse);
        totalEmissiveRadiance += uInfect * tdRim * vFx.y * 0.9;
        totalEmissiveRadiance += vec3(0.4, 0.85, 1.0) * tdRim * vFx2.w * 0.6;
        totalEmissiveRadiance += vec3(1.0, 0.15, 0.1) * vFx2.z * vFx2.z * (0.5 + 0.5 * sin(uTime * 10.0)) * 0.6;
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * vFx.x * 0.25;
      `;
    } else if (kind === 'enemy') {
      // vFx: x flash, y dissolve, z alpha (stealth), w slow ; vFx2: x burn, y hardened, z glow, w immune shimmer
      colorMod = `
        if (vFx.y > 0.0) {
          float tdN = tdHash(floor(vObjPos * 7.0));
          if (tdN < vFx.y) discard;
        }
        if (vFx.z < 0.999) {
          if (tdIgn(gl_FragCoord.xy) > vFx.z) discard;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.85, 1.0), vFx.w * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.7), vFx2.y * 0.6);
      `;
      emissiveMod = `
        ${rim}
        totalEmissiveRadiance += vEmissive * (1.0 + vFx2.z * 1.4);
        totalEmissiveRadiance += vColor.rgb * vFx2.z * 0.45;
        totalEmissiveRadiance += vec3(1.0) * vFx.x * 0.95;
        totalEmissiveRadiance += vec3(1.0, 0.45, 0.1) * vFx2.x * (0.35 + 0.35 * sin(uTime * 23.0 + vObjPos.y * 9.0));
        totalEmissiveRadiance += uRim * tdRim * uRimStrength * 0.8;
        totalEmissiveRadiance += vec3(0.5, 0.9, 1.0) * tdRim * vFx.w * 0.8;
        totalEmissiveRadiance += vec3(0.85, 0.7, 1.0) * tdRim * vFx2.w * (0.6 + 0.4 * sin(uTime * 9.0));
        totalEmissiveRadiance += vec3(1.0, 0.75, 0.2) * tdRim * vFx2.y * 0.8;
        if (vFx.y > 0.0) {
          float tdE = tdHash(floor(vObjPos * 7.0));
          totalEmissiveRadiance += vec3(1.0, 0.9, 0.7) * smoothstep(vFx.y + 0.18, vFx.y, tdE) * 2.0;
        }
        if (vFx.z < 0.999) totalEmissiveRadiance += vec3(0.6, 0.4, 1.0) * tdRim * 0.8;
      `;
    } else if (kind === 'hero') {
      emissiveMod = `
        ${rim}
        totalEmissiveRadiance += vEmissive;
        totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * tdRim * 0.45;
      `;
    } else {
      emissiveMod = 'totalEmissiveRadiance += vEmissive;\n';
    }
    f = f.replace('#include <color_fragment>', '#include <color_fragment>\n' + colorMod);
    f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emissiveMod);
    shader.fragmentShader = f;
  };
}

/**
 * Cheap diffuse variant for large static surfaces (floor, pads, core, decorations): Lambert shading costs a fraction of
 * the PBR path per pixel, which matters because the floor covers the whole screen.
 */
export function createStaticMaterial(u: SharedUniforms, opts: { flat?: boolean } = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: opts.flat ?? false });
  const p = patch('static');
  m.onBeforeCompile = (shader) => p(shader, u);
  m.customProgramCacheKey = () => 'td-static-lambert' + (m.flatShading ? '-f' : '-s');
  return m;
}

/** Vertex-coloured, emissive-attribute MeshStandardMaterial with the FX patch of `kind`. */
export function createCellMaterial(
  kind: CellKind,
  u: SharedUniforms,
  opts: { flat?: boolean; roughness?: number; metalness?: number } = {},
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: opts.flat ?? true,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.0,
  });
  const p = patch(kind);
  m.onBeforeCompile = (shader) => p(shader, u);
  m.customProgramCacheKey = () => 'td-cell-' + kind + (m.flatShading ? '-f' : '-s');
  return m;
}
