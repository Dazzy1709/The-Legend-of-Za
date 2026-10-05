// src/babylon/world/UvUtils.ts

import { Matrix, Mesh, Vector3, VertexBuffer } from "@babylonjs/core";

/**
 * Rewrites a mesh's UVs so its texture tiles at a fixed real-world size
 * (`tileSize` world-units per repeat) regardless of the mesh's own
 * dimensions, position, or rotation. Fixes the "one texture repeat
 * smeared across the whole mesh" stretching that MeshBuilder's default
 * UVs (always 0->1 per mesh) cause on anything whose physical size
 * varies — long street strips, wall segments of different lengths,
 * buildings of different widths, etc.
 *
 * Works on any mesh with position + normal data by projecting each
 * vertex onto whichever world-axis plane its normal most faces (X, Y,
 * or Z) — a flat ground mesh ends up using X/Z, a vertical wall face
 * ends up using Z/Y or X/Y — and it stays correct for rotated/translated
 * meshes since it goes through the mesh's world matrix rather than
 * assuming an unrotated mesh sitting at a manually-tracked "center".
 *
 * Call this AFTER any code that moves vertices (e.g. terrain-conforming)
 * and after normals are up to date, since it reads both.
 */
export function applyWorldScaledUV(mesh: Mesh, tileSize: number) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!positions || !normals) return;

  mesh.computeWorldMatrix(true);
  const world = mesh.getWorldMatrix();
  const normalMatrix = Matrix.Transpose(Matrix.Invert(world));

  const uvs = new Float32Array((positions.length / 3) * 2);
  const p = Vector3.Zero();
  const n = Vector3.Zero();

  for (let i = 0, u = 0; i < positions.length; i += 3, u += 2) {
    Vector3.TransformCoordinatesFromFloatsToRef(positions[i], positions[i + 1], positions[i + 2], world, p);
    Vector3.TransformNormalFromFloatsToRef(normals[i], normals[i + 1], normals[i + 2], normalMatrix, n);

    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);

    if (ax >= ay && ax >= az) {
      // Face points mostly along X -> project onto the Z/Y plane.
      uvs[u] = p.z / tileSize;
      uvs[u + 1] = p.y / tileSize;
    } else if (ay >= ax && ay >= az) {
      // Face points mostly along Y (up/down, e.g. a road/sidewalk) -> X/Z.
      uvs[u] = p.x / tileSize;
      uvs[u + 1] = p.z / tileSize;
    } else {
      // Face points mostly along Z -> project onto the X/Y plane.
      uvs[u] = p.x / tileSize;
      uvs[u + 1] = p.y / tileSize;
    }
  }

  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}