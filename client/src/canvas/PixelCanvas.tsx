import { useRef, useEffect, useCallback, useState } from 'react';
import { useProject, useProjectDispatch } from '../store/ProjectContext';
import { executeInstructions } from './renderer';

export default function PixelCanvas() {
  const state = useProject();
  const dispatch = useProjectDispatch();
  const { instructions, currentStep, zoom, showGrid, canvasWidth, canvasHeight } = state;

  const bgRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const pxW = canvasWidth * zoom;
  const pxH = canvasHeight * zoom;

  // Draw checkerboard background
  useEffect(() => {
    const canvas = bgRef.current;
    if (!canvas) return;
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d')!;
    const cellSize = Math.max(zoom, 4);
    for (let y = 0; y < pxH; y += cellSize) {
      for (let x = 0; x < pxW; x += cellSize) {
        const isLight = ((x / cellSize) + (y / cellSize)) % 2 === 0;
        ctx.fillStyle = isLight ? '#c8c8c8' : '#9a9a9a';
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }, [pxW, pxH, zoom]);

  // Render pixel data on main canvas
  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas) return;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d')!;
    if (instructions.length === 0 || currentStep === 0) {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      dispatch({ type: 'SET_RENDER_META', currentColorHex: '#000000', lastComment: null });
      return;
    }
    const { imageData, currentColorHex, lastComment } = executeInstructions(instructions, currentStep);
    ctx.putImageData(imageData, 0, 0);
    dispatch({ type: 'SET_RENDER_META', currentColorHex, lastComment });
  }, [instructions, currentStep, canvasWidth, canvasHeight]);

  // Draw grid overlay — 3-layer lines: dark, white, dark for visibility on any background
  useEffect(() => {
    const canvas = gridRef.current;
    if (!canvas) return;
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, pxW, pxH);
    if (!showGrid || zoom < 4) return;

    const layers: [string, number][] = [
      ['rgba(0,0,0,0.4)', 3],
      ['rgba(255,255,255,0.6)', 1],
    ];

    for (const [color, width] of layers) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = 0; x <= canvasWidth; x++) {
        const px = x * zoom + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, pxH);
      }
      for (let y = 0; y <= canvasHeight; y++) {
        const py = y * zoom + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(pxW, py);
      }
      ctx.stroke();
    }
  }, [showGrid, zoom, canvasWidth, canvasHeight, pxW, pxH]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    dispatch({ type: 'SET_ZOOM', zoom: state.zoom + delta });
  }, [dispatch, state.zoom]);

  // Pan with mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="pixel-canvas-wrapper"
      style={{ width: pxW, height: pxH, transform: `translate(${pan.x}px, ${pan.y}px)` }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas ref={bgRef} className="canvas-bg" style={{ width: pxW, height: pxH }} />
      <canvas ref={mainRef} className="canvas-main" style={{ width: pxW, height: pxH }} />
      <canvas ref={gridRef} className="canvas-grid" style={{ width: pxW, height: pxH, display: (showGrid && zoom >= 4) ? 'block' : 'none' }} />
    </div>
  );
}
