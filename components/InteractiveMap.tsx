import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';

const InteractiveMap = ({
  ndviData,
  bbox,
  onViewStateChange = () => {},
  show3D = false,
  layerType = 'scatter',
  location
}) => {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const pointsRef = useRef([]);
  const isDraggingRef = useRef(false);
  const previousMouseRef = useRef({ x: 0, y: 0 });
  
  const [currentLayerType, setCurrentLayerType] = useState('scatter');
  const [currentShow3D, setCurrentShow3D] = useState(show3D);
  const [demoData, setDemoData] = useState([]);
  const [rotation, setRotation] = useState({ x: 0.5, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [darkMode, setDarkMode] = useState(false);
  const [center, setCenter] = useState({ lat: 40, lon: -95, name: 'Selected Location' });

  useEffect(() => {
    // Sync theme from root
    const updateTheme = () => setDarkMode(document.documentElement.classList.contains('dark'))
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, []);

  useEffect(() => {
    if (location?.lat && location?.lon){
      setCenter({ lat: location.lat, lon: location.lon, name: location.name || 'Selected Location' })
    }
  }, [location?.lat, location?.lon, location?.name])

  useEffect(() => {
    generateDemoData();
  }, [center.lat, center.lon]);

  const generateDemoData = () => {
    const points = [];
    const gridSize = 60;
    const spacing = 0.008;
    
    for (let x = 0; x < gridSize; x++) {
      for (let y = 0; y < gridSize; y++) {
        const lat = center.lat + (x - gridSize/2) * spacing;
        const lon = center.lon + (y - gridSize/2) * spacing;
        
        const distanceFromCenter = Math.sqrt(
          Math.pow(x - gridSize/2, 2) + Math.pow(y - gridSize/2, 2)
        );
        
        let baseNDVI = 0.3 + (distanceFromCenter / (gridSize/2)) * 0.5;
        baseNDVI += (Math.random() - 0.5) * 0.15;
        
        const terrainNoise = 
          Math.sin(x * 0.2) * Math.cos(y * 0.2) * 0.15 +
          Math.sin(x * 0.1) * Math.cos(y * 0.15) * 0.1 +
          Math.sin(x * 0.05) * Math.cos(y * 0.05) * 0.08;
        baseNDVI += terrainNoise;
        
        baseNDVI = Math.max(-0.2, Math.min(1.0, baseNDVI));
        
        if (Math.random() < 0.05) {
          baseNDVI = Math.random() < 0.6 ? 0.85 : -0.15;
        }
        
        points.push({
          x: (x - gridSize/2) * 2,
          y: (y - gridSize/2) * 2,
          ndvi: baseNDVI,
          elevation: baseNDVI * 25,
          color: getNDVIColor(baseNDVI),
          cityName: center.name
        });
      }
    }
    
    setDemoData(points);
    setRotation({ x: 0.5, y: 0 });
    setZoom(1);
  };

  const getNDVIColor = (ndvi) => {
    const clamped = Math.max(-1, Math.min(1, ndvi));
    
    // Realistic topographic color scheme
    if (clamped < -0.1) {
      // Deep water (deep blue to medium blue)
      const t = (clamped + 1) / 0.9;
      return [
        Math.floor(40 + t * 60),
        Math.floor(80 + t * 100),
        Math.floor(140 + t * 80)
      ];
    } else if (clamped < 0.05) {
      // Shallow water to coast (blue to light cyan)
      const t = (clamped + 0.1) / 0.15;
      return [
        Math.floor(100 + t * 80),
        Math.floor(180 + t * 50),
        Math.floor(220 - t * 30)
      ];
    } else if (clamped < 0.15) {
      // Coastal/beach (tan/beige)
      const t = (clamped - 0.05) / 0.1;
      return [
        Math.floor(180 + t * 30),
        Math.floor(230 - t * 30),
        Math.floor(190 - t * 50)
      ];
    } else if (clamped < 0.3) {
      // Low vegetation (yellow-tan to olive)
      const t = (clamped - 0.15) / 0.15;
      return [
        Math.floor(210 - t * 50),
        Math.floor(200 - t * 20),
        Math.floor(140 - t * 50)
      ];
    } else if (clamped < 0.5) {
      // Moderate vegetation (olive to yellow-green)
      const t = (clamped - 0.3) / 0.2;
      return [
        Math.floor(160 - t * 30),
        Math.floor(180 + t * 30),
        Math.floor(90 - t * 10)
      ];
    } else if (clamped < 0.7) {
      // Dense vegetation (green to dark green)
      const t = (clamped - 0.5) / 0.2;
      return [
        Math.floor(130 - t * 70),
        Math.floor(210 - t * 60),
        Math.floor(80 + t * 20)
      ];
    } else {
      // Very dense vegetation (dark green to brown-green for peaks)
      const t = (clamped - 0.7) / 0.3;
      return [
        Math.floor(60 + t * 80),
        Math.floor(150 - t * 30),
        Math.floor(100 - t * 40)
      ];
    }
  };

  useEffect(() => {
    if (!mountRef.current || demoData.length === 0) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(darkMode ? 0x1a1a1a : 0xe8f0f5);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      60,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 60, 100);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting - adjusted for dark/light mode
    const ambientLight = new THREE.AmbientLight(0xffffff, darkMode ? 0.5 : 0.75);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, darkMode ? 0.6 : 0.5);
    directionalLight.position.set(50, 80, 50);
    scene.add(directionalLight);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, darkMode ? 0.3 : 0.25);
    directionalLight2.position.set(-50, 40, -50);
    scene.add(directionalLight2);

    // Ground plane - adjusted for dark/light mode
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshPhongMaterial({ 
      color: darkMode ? 0x0d0d0d : 0xd8e8f0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: darkMode ? 0.6 : 0.4
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Grid helper - adjusted for dark/light mode
    const gridHelper = new THREE.GridHelper(
      100, 
      20, 
      darkMode ? 0x444444 : 0xb0d0e0, 
      darkMode ? 0x2a2a2a : 0xc8e0f0
    );
    gridHelper.material.opacity = darkMode ? 0.4 : 0.3;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Create NDVI visualization
    createVisualization(scene);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (sceneRef.current) {
        sceneRef.current.rotation.x = rotation.x;
        sceneRef.current.rotation.y = rotation.y;
        
        if (cameraRef.current) {
          const baseDistance = 100;
          const distance = baseDistance / zoom;
          cameraRef.current.position.set(0, 60 / zoom, distance);
          cameraRef.current.lookAt(0, 0, 0);
        }
      }
      
      renderer.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (mountRef.current && cameraRef.current && rendererRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [demoData, currentLayerType, currentShow3D, rotation, zoom, darkMode]);

  const createVisualization = (scene) => {
    // Remove old points
    pointsRef.current.forEach(obj => scene.remove(obj));
    pointsRef.current = [];

    // Create a continuous terrain mesh
    const gridSize = Math.sqrt(demoData.length);
    const segmentSize = 2;
    
    if (currentLayerType === 'heatmap' || currentLayerType === 'scatter') {
      // Create smooth topographic surface
      const geometry = new THREE.PlaneGeometry(
        gridSize * segmentSize,
        gridSize * segmentSize,
        gridSize - 1,
        gridSize - 1
      );
      
      const vertices = geometry.attributes.position.array;
      const colors = [];
      
      for (let i = 0; i < demoData.length; i++) {
        const point = demoData[i];
        const vertexIndex = i * 3;
        
        // Set height based on NDVI for 3D depth
        vertices[vertexIndex + 2] = currentShow3D ? point.elevation * 1.5 : point.elevation * 0.6;
        
        // Add vertex colors
        colors.push(
          point.color[0] / 255,
          point.color[1] / 255,
          point.color[2] / 255
        );
      }
      
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      
      // Main terrain surface - smooth topographic appearance
      const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        flatShading: false,
        shininess: darkMode ? 15 : 20,
        specular: new THREE.Color(darkMode ? 0x222222 : 0x333333),
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
        reflectivity: 0.3
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      pointsRef.current.push(mesh);
      
      // Add contour lines for topographic effect
      addContourLines(scene, geometry, demoData, gridSize);
      
    } else {
      // Column mode only; otherwise mesh covers
      demoData.forEach(point => {
        if (currentLayerType === 'column') {
          const color = new THREE.Color(
            point.color[0] / 255,
            point.color[1] / 255,
            point.color[2] / 255
          );
          const height = currentShow3D ? Math.max(point.elevation, 1) : 1;
          const geometry = new THREE.CylinderGeometry(0.4, 0.4, height, 12);
          const material = new THREE.MeshPhongMaterial({ color });
          const cylinder = new THREE.Mesh(geometry, material);
          cylinder.position.set(point.x, height / 2, point.y);
          scene.add(cylinder);
          pointsRef.current.push(cylinder);
        }
      });
    }
  };

  const addContourLines = (scene, geometry, data, gridSize) => {
    const contourIntervals = [-0.1, 0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const positions = geometry.attributes.position;
    
    contourIntervals.forEach(interval => {
      const points = [];
      
      // Create contour lines by finding edges that cross the interval
      for (let y = 0; y < gridSize - 1; y++) {
        for (let x = 0; x < gridSize - 1; x++) {
          const idx = y * gridSize + x;
          
          const p1 = data[idx];
          const p2 = data[idx + 1];
          const p3 = data[idx + gridSize];
          const p4 = data[idx + gridSize + 1];
          
          // Check horizontal edges
          if ((p1.ndvi - interval) * (p2.ndvi - interval) < 0) {
            const t = (interval - p1.ndvi) / (p2.ndvi - p1.ndvi);
            const x1 = positions.getX(idx);
            const y1 = positions.getY(idx);
            const z1 = positions.getZ(idx);
            const x2 = positions.getX(idx + 1);
            const y2 = positions.getY(idx + 1);
            const z2 = positions.getZ(idx + 1);
            
            points.push(new THREE.Vector3(
              x1 + (x2 - x1) * t,
              y1 + (y2 - y1) * t,
              z1 + (z2 - z1) * t + 0.1
            ));
          }
          
          // Check vertical edges
          if ((p1.ndvi - interval) * (p3.ndvi - interval) < 0) {
            const t = (interval - p1.ndvi) / (p3.ndvi - p1.ndvi);
            const x1 = positions.getX(idx);
            const y1 = positions.getY(idx);
            const z1 = positions.getZ(idx);
            const x3 = positions.getX(idx + gridSize);
            const y3 = positions.getY(idx + gridSize);
            const z3 = positions.getZ(idx + gridSize);
            
            points.push(new THREE.Vector3(
              x1 + (x3 - x1) * t,
              y1 + (y3 - y1) * t,
              z1 + (z3 - z1) * t + 0.1
            ));
          }
        }
      }
      
      if (points.length > 1) {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({ 
          color: darkMode ? 0x555555 : 0x000000, 
          opacity: darkMode ? 0.25 : 0.18, 
          transparent: true,
          linewidth: 1
        });
        const line = new THREE.LineSegments(lineGeometry, lineMaterial);
        line.rotation.x = -Math.PI / 2;
        scene.add(line);
        pointsRef.current.push(line);
      }
    });
  };

  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    previousMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;

    const deltaX = e.clientX - previousMouseRef.current.x;
    const deltaY = e.clientY - previousMouseRef.current.y;

    setRotation(prev => ({
      x: prev.x + deltaY * 0.01,
      y: prev.y + deltaX * 0.01
    }));

    previousMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.5, Math.min(3, prev * delta)));
  };

  const cityName = demoData.length > 0 ? demoData[0].cityName : (location?.name || 'Selected Location');
  const ndviValues = demoData.map(d => d.ndvi);
  const minNDVI = ndviValues.length > 0 ? Math.min(...ndviValues) : 0;
  const maxNDVI = ndviValues.length > 0 ? Math.max(...ndviValues) : 0;
  const meanNDVI = ndviValues.length > 0 ? ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length : 0;

  return (
    <div style={{ height: '600px', width: '100%', position: 'relative' }}>
      <div
        ref={mountRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          width: '100%',
          height: '100%',
          cursor: isDraggingRef.current ? 'grabbing' : 'grab',
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      />

      {/* Controls Panel (dark mode synced; toggle removed) */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: darkMode ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        padding: '15px',
        borderRadius: '8px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        minWidth: '200px',
        backdropFilter: 'blur(10px)',
        color: darkMode ? '#e5e7eb' : '#333'
      }}>
        <div style={{ marginBottom: '12px', fontWeight: 'bold', fontSize: '16px' }}>
          Map Controls
        </div>
        
        <div style={{ marginBottom: '8px', fontSize: '13px', color: darkMode ? '#94a3b8' : '#666' }}>Layer Type:</div>
        <select
          value={currentLayerType}
          onChange={(e) => setCurrentLayerType(e.target.value)}
          style={{ 
            marginBottom: '12px', 
            width: '100%', 
            padding: '8px',
            borderRadius: '4px',
            border: darkMode ? '1px solid #555' : '1px solid #ddd',
            fontSize: '13px',
            background: darkMode ? '#1f2937' : 'white',
            color: darkMode ? '#e5e7eb' : '#333'
          }}
        >
          <option value="heatmap">Topographic Map</option>
          <option value="scatter">Scatter Points</option>
          <option value="column">3D Columns</option>
        </select>
        
        <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={currentShow3D}
            onChange={(e) => setCurrentShow3D(e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Full Height (Toggle for more/less depth)
        </label>
        
        

        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: darkMode ? '1px solid #444' : '1px solid #ddd' }}>
          <div style={{ fontSize: '12px', color: darkMode ? '#94a3b8' : '#666', marginBottom: '4px' }}>
            Zoom: {zoom.toFixed(2)}x
          </div>
          <button
            onClick={() => setRotation({ x: 0.5, y: 0 })}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              marginTop: '4px'
            }}
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Info Panel */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: darkMode ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        padding: '15px',
        borderRadius: '8px',
        fontSize: '13px',
        maxWidth: '250px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(10px)',
        color: darkMode ? '#e5e7eb' : '#333'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '16px' }}>
          {cityName} - NDVI Analysis
        </div>
        <div style={{ marginBottom: '4px' }}><strong>Layer:</strong> {currentLayerType === 'column' ? '3D Columns' : currentLayerType === 'scatter' ? 'Scatter Points' : 'Topographic Map'}</div>
        <div style={{ marginBottom: '4px' }}><strong>3D Mode:</strong> {currentShow3D ? 'On' : 'Off'}</div>
        <div style={{ marginBottom: '4px' }}><strong>Data Points:</strong> {demoData.length.toLocaleString()}</div>
        <hr style={{ margin: '8px 0', border: 'none', borderTop: darkMode ? '1px solid #444' : '1px solid #ddd' }} />
        <div style={{ marginBottom: '4px' }}><strong>Min NDVI:</strong> {minNDVI.toFixed(3)}</div>
        <div style={{ marginBottom: '4px' }}><strong>Max NDVI:</strong> {maxNDVI.toFixed(3)}</div>
        <div><strong>Mean NDVI:</strong> {meanNDVI.toFixed(3)}</div>
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        background: darkMode ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        padding: '12px',
        borderRadius: '8px',
        fontSize: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(10px)',
        color: darkMode ? '#e5e7eb' : '#333'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>NDVI Legend</div>
        {[
          { color: [40, 80, 140], label: 'Deep Water (<-0.1)' },
          { color: [100, 180, 220], label: 'Shallow Water (0)' },
          { color: [180, 230, 190], label: 'Coastal (0.05)' },
          { color: [210, 200, 140], label: 'Low Veg (0.15)' },
          { color: [130, 180, 90], label: 'Moderate (0.5)' },
          { color: [60, 150, 100], label: 'Dense Veg (0.7)' },
          { color: [140, 120, 60], label: 'Very Dense (>0.8)' }
        ].map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
            <div style={{
              width: '16px',
              height: '16px',
              background: `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`,
              marginRight: '8px',
              borderRadius: '2px',
              border: darkMode ? '1px solid #555' : '1px solid #ddd'
            }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        background: darkMode ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        padding: '10px',
        borderRadius: '8px',
        fontSize: '11px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        backdropFilter: 'blur(10px)',
        maxWidth: '200px',
        color: darkMode ? '#e5e7eb' : '#333'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Controls:</div>
        <div>• Click + drag to rotate</div>
        <div>• Scroll to zoom</div>
        <div>• Toggle 3D for elevation</div>
        <div>• Reset view button available</div>
      </div>
    </div>
  );
};

export default InteractiveMap;