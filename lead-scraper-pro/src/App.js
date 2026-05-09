import { useState, useEffect, useRef } from 'react';
import { Building2, Search, Download, Trash2, X, Loader, MapPin, Plus } from 'lucide-react';

export default function App() {
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  const [leads, setLeads] = useState([]);
  const [scrapedData, setScrapedData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [location, setLocation] = useState('');
  const [country, setCountry] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [mapQuery, setMapQuery] = useState('');
  const [mapSearchInput, setMapSearchInput] = useState('');
  const [maxLeads, setMaxLeads] = useState(60);
  /** When true, backend runs Smarty RDI / residence classification after Google discovery (US addresses). */
  const [classifyResidence, setClassifyResidence] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [selectedArea, setSelectedArea] = useState(null);
  const [areaDetails, setAreaDetails] = useState('');
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [backendHealth, setBackendHealth] = useState(null);
  const [lastScrapeInfo, setLastScrapeInfo] = useState(null);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const multiPolygonModeRef = useRef(false);
  const multiPolygonsRef = useRef([]);

  // Load Google Maps API
  useEffect(() => {
    // If Google Maps is already fully loaded
    if (window.google?.maps?.Map) {
      setLeafletLoaded(true);
      return;
    }

    // If state already shows it's loaded, return
    if (leafletLoaded) {
      return;
    }

    // Check if script is already in the page
    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      // Script exists, wait for it to load
      const checkGoogleMaps = setInterval(() => {
        if (window.google?.maps?.Map) {
          clearInterval(checkGoogleMaps);
          setLeafletLoaded(true);
        }
      }, 100);

      // Cleanup interval after 10 seconds
      setTimeout(() => clearInterval(checkGoogleMaps), 10000);
      return;
    }

    // Define callback function before adding script
    window.initMap = () => {
      setLeafletLoaded(true);
      delete window.initMap;
    };

    // Create and add script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&libraries=drawing,places&callback=initMap`;
    script.async = true;
    script.onerror = () => {
      console.error('Failed to load Google Maps API');
    };

    document.head.appendChild(script);
  }, [leafletLoaded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`);
        const data = await response.json();
        if (!cancelled) {
          setBackendHealth(response.ok ? { ok: true, ...data } : { ok: false });
        }
      } catch {
        if (!cancelled) setBackendHealth({ ok: false });
      }
    })();
    return () => { cancelled = true; };
  }, [API_URL]);

  // Initialize Google Map
  useEffect(() => {
    if (activeTab !== 'map' || !mapRef.current || !leafletLoaded || !window.google?.maps) return;

    // Always reinitialize the map when returning to the map tab to ensure proper DOM attachment
    if (mapInstanceRef.current) {
      // Clean up existing map instance
      mapInstanceRef.current = null;
    }

    if (drawnItemsRef.current) {
      drawnItemsRef.current = null;
    }

    const map = new window.google.maps.Map(mapRef.current, {
      center: { lat: 40.7128, lng: -74.0060 },
      zoom: 12,
      mapTypeControl: true,
      fullscreenControl: true,
      streetViewControl: true,
      rotateControl: true,
      tilt: 45,
      mapId: 'DEMO_MAP_ID'  // Required for some advanced 3D features
    });

    const drawingManager = new window.google.maps.drawing.DrawingManager({
      drawingMode: null,
      drawingControl: false,  // Disable default controls, we'll use custom buttons
      circleOptions: {
        fillColor: '#9333ea',
        fillOpacity: 0.3,
        strokeColor: '#9333ea',
        strokeWeight: 2,
        clickable: true,
        editable: true,
        zIndex: 1
      },
      polygonOptions: {
        fillColor: '#9333ea',
        fillOpacity: 0.3,
        strokeColor: '#9333ea',
        strokeWeight: 2,
        clickable: true,
        editable: true,
        zIndex: 1
      },
      rectangleOptions: {
        fillColor: '#9333ea',
        fillOpacity: 0.3,
        strokeColor: '#9333ea',
        strokeWeight: 2,
        clickable: true,
        editable: true,
        zIndex: 1
      },
      polylineOptions: {
        strokeColor: '#9333ea',
        strokeWeight: 3,
        clickable: true,
        editable: true,
        zIndex: 1
      }
    });

    drawingManager.setMap(map);

    // Create custom drawing controls container - positioned on left side
    const controlDiv = document.createElement('div');
    controlDiv.style.margin = '10px';
    controlDiv.style.display = 'flex';
    controlDiv.style.flexDirection = 'column';  // Stack vertically
    controlDiv.style.gap = '8px';

    // Helper function to create custom buttons
    const createDrawButton = (text, icon, drawingMode, bgColor = '#9333ea') => {
      const button = document.createElement('button');
      button.innerHTML = `${icon} ${text}`;
      button.style.backgroundColor = bgColor;
      button.style.color = 'white';
      button.style.border = 'none';
      button.style.padding = '10px 16px';
      button.style.fontSize = '14px';
      button.style.fontWeight = '600';
      button.style.cursor = 'pointer';
      button.style.borderRadius = '8px';
      button.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      button.style.transition = 'all 0.2s';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.gap = '6px';
      button.style.whiteSpace = 'nowrap';

      button.onmouseover = () => {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
      };
      button.onmouseout = () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
      };

      button.onclick = () => {
        if (drawingMode === 'delete') {
          deleteDrawing();
        } else {
          drawingManager.setDrawingMode(drawingMode);
        }
      };

      return button;
    };

    // Create individual buttons
    const circleButton = createDrawButton('Circle', '⭕', window.google.maps.drawing.OverlayType.CIRCLE);
    const polygonButton = createDrawButton('Polygon', '⬡', window.google.maps.drawing.OverlayType.POLYGON);
    const rectangleButton = createDrawButton('Rectangle', '▭', window.google.maps.drawing.OverlayType.RECTANGLE);
    const polylineButton = createDrawButton('Line', '✏️', window.google.maps.drawing.OverlayType.POLYLINE);

    // Create multi-polygon button with special handling
    const multiPolygonButton = document.createElement('button');
    multiPolygonButton.innerHTML = '🔷 Multi';
    multiPolygonButton.style.backgroundColor = '#9333ea';  // Purple color (same as other buttons)
    multiPolygonButton.style.color = 'white';
    multiPolygonButton.style.border = 'none';
    multiPolygonButton.style.padding = '10px 16px';
    multiPolygonButton.style.fontSize = '14px';
    multiPolygonButton.style.fontWeight = '600';
    multiPolygonButton.style.cursor = 'pointer';
    multiPolygonButton.style.borderRadius = '8px';
    multiPolygonButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    multiPolygonButton.style.transition = 'all 0.2s';
    multiPolygonButton.style.display = 'flex';
    multiPolygonButton.style.alignItems = 'center';
    multiPolygonButton.style.gap = '6px';
    multiPolygonButton.style.whiteSpace = 'nowrap';

    multiPolygonButton.onmouseover = () => {
      multiPolygonButton.style.transform = 'translateY(-2px)';
      multiPolygonButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
    };
    multiPolygonButton.onmouseout = () => {
      multiPolygonButton.style.transform = 'translateY(0)';
      multiPolygonButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    };

    multiPolygonButton.onclick = () => {
      if (!multiPolygonModeRef.current) {
        // Enable multi-polygon mode
        multiPolygonModeRef.current = true;
        multiPolygonButton.innerHTML = '🔷 Multi (Active)';
        multiPolygonButton.style.backgroundColor = '#7c3aed';  // Darker purple
        drawingManager.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);
      } else {
        // Disable multi-polygon mode
        multiPolygonModeRef.current = false;
        multiPolygonButton.innerHTML = '🔷 Multi';
        multiPolygonButton.style.backgroundColor = '#9333ea';  // Same purple as other buttons
        drawingManager.setDrawingMode(null);
      }
    };

    // Create edit button with toggle functionality
    const editButton = document.createElement('button');
    editButton.innerHTML = '🔧 Edit';
    editButton.style.backgroundColor = '#f59e0b';  // Amber/orange color
    editButton.style.color = 'white';
    editButton.style.border = 'none';
    editButton.style.padding = '10px 16px';
    editButton.style.fontSize = '14px';
    editButton.style.fontWeight = '600';
    editButton.style.cursor = 'pointer';
    editButton.style.borderRadius = '8px';
    editButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    editButton.style.transition = 'all 0.2s';
    editButton.style.display = 'none';  // Hidden initially
    editButton.style.whiteSpace = 'nowrap';

    let isEditing = true;  // Track edit state
    editButton.onclick = () => {
      if (drawnItemsRef.current) {
        isEditing = !isEditing;
        drawnItemsRef.current.setEditable(isEditing);
        editButton.innerHTML = isEditing ? '🔧 Edit' : '🔒 Locked';
        editButton.style.backgroundColor = isEditing ? '#f59e0b' : '#6b7280';
      }
    };

    editButton.onmouseover = () => {
      editButton.style.transform = 'translateY(-2px)';
      editButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
    };
    editButton.onmouseout = () => {
      editButton.style.transform = 'translateY(0)';
      editButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
    };

    const deleteButton = createDrawButton('Delete', '🗑️', 'delete', '#dc2626');
    deleteButton.style.display = 'none';  // Hidden initially

    // Add buttons to control container
    controlDiv.appendChild(circleButton);
    controlDiv.appendChild(polygonButton);
    controlDiv.appendChild(rectangleButton);
    controlDiv.appendChild(polylineButton);
    controlDiv.appendChild(multiPolygonButton);
    controlDiv.appendChild(editButton);
    controlDiv.appendChild(deleteButton);

    // Add custom controls to map - positioned on left side
    map.controls[window.google.maps.ControlPosition.LEFT_TOP].push(controlDiv);

    window.google.maps.event.addListener(drawingManager, 'overlaycomplete', (event) => {
      // Debug log
      console.log('Drawing completed, type:', event.type, 'overlay:', event.overlay);

      // Handle multi-polygon mode
      if (multiPolygonModeRef.current && event.type === 'polygon') {
        // Add to multi-polygon array
        multiPolygonsRef.current.push(event.overlay);
        event.overlay.setEditable(true);

        // Continue drawing mode for more polygons
        drawingManager.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);

        // Collect all polygon coordinates
        const allPolygonCoords = multiPolygonsRef.current.map(poly => {
          const path = poly.getPath();
          const coordinates = [];
          path.forEach((latLng) => {
            coordinates.push({ lat: latLng.lat(), lng: latLng.lng() });
          });
          return coordinates;
        });

        setSelectedArea({
          type: 'multipolygon',
          polygons: allPolygonCoords
        });

        // Format coordinates for display
        const polygonDetails = allPolygonCoords.map((coords, polyIdx) => {
          const coordsText = coords.map((coord, idx) =>
            `  Point ${idx + 1}: ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`
          ).join('\n');
          return `Polygon ${polyIdx + 1} (${coords.length} points):\n${coordsText}`;
        }).join('\n\n');

        setAreaDetails(`Multi-Polygon with ${multiPolygonsRef.current.length} polygon(s)\n\n${polygonDetails}`);

        // Show edit/delete buttons
        editButton.style.display = 'flex';
        editButton.style.alignItems = 'center';
        editButton.style.gap = '6px';
        deleteButton.style.display = 'flex';
        deleteButton.style.alignItems = 'center';
        deleteButton.style.gap = '6px';

        return;
      }

      // Remove previous shape if exists (normal mode)
      if (drawnItemsRef.current) {
        drawnItemsRef.current.setMap(null);
      }

      drawnItemsRef.current = event.overlay;
      drawingManager.setDrawingMode(null);

      // Enable editing on the shape and show edit/delete buttons
      event.overlay.setEditable(true);
      isEditing = true;
      editButton.style.display = 'flex';
      editButton.style.alignItems = 'center';
      editButton.style.gap = '6px';
      editButton.innerHTML = '🔧 Edit';
      editButton.style.backgroundColor = '#f59e0b';
      deleteButton.style.display = 'flex';
      deleteButton.style.alignItems = 'center';
      deleteButton.style.gap = '6px';

      let bounds, center;
      if (event.type === 'circle') {
        center = event.overlay.getCenter();
        const radius = event.overlay.getRadius();
        setSelectedArea({
          type: 'circle',
          center: { lat: center.lat(), lng: center.lng() },
          radius: radius
        });
        setAreaDetails(`Center: ${center.lat().toFixed(4)}, ${center.lng().toFixed(4)}, Radius: ${(radius / 1000).toFixed(2)}km`);
      } else if (event.type === 'rectangle') {
        bounds = event.overlay.getBounds();
        center = bounds.getCenter();

        // Get all 4 corner points
        const northEast = bounds.getNorthEast();
        const southWest = bounds.getSouthWest();
        const northWest = { lat: northEast.lat(), lng: southWest.lng() };
        const southEast = { lat: southWest.lat(), lng: northEast.lng() };

        setSelectedArea({
          type: 'rectangle',
          bounds: {
            north: northEast.lat(),
            south: southWest.lat(),
            east: northEast.lng(),
            west: southWest.lng()
          }
        });

        // Format all corner coordinates for display
        const cornerDetails = `Rectangle with 4 corners:
Point 1 (North-East): ${northEast.lat().toFixed(6)}, ${northEast.lng().toFixed(6)}
Point 2 (North-West): ${northWest.lat.toFixed(6)}, ${northWest.lng.toFixed(6)}
Point 3 (South-West): ${southWest.lat().toFixed(6)}, ${southWest.lng().toFixed(6)}
Point 4 (South-East): ${southEast.lat.toFixed(6)}, ${southEast.lng.toFixed(6)}
Center: ${center.lat().toFixed(6)}, ${center.lng().toFixed(6)}`;

        setAreaDetails(cornerDetails);
      } else if (event.type === 'polygon') {
        const path = event.overlay.getPath();
        const coordinates = [];
        path.forEach((latLng) => {
          coordinates.push({ lat: latLng.lat(), lng: latLng.lng() });
        });
        setSelectedArea({
          type: 'polygon',
          coordinates: coordinates
        });
        // Format coordinates for display
        const coordsText = coordinates.map((coord, idx) =>
          `Point ${idx + 1}: ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`
        ).join('\n');
        setAreaDetails(`Polygon with ${coordinates.length} points:\n${coordsText}`);
      } else if (event.type === window.google.maps.drawing.OverlayType.POLYLINE || event.type === 'polyline') {
        console.log('Polyline detected, getting path...');
        const path = event.overlay.getPath();
        const coordinates = [];
        path.forEach((latLng) => {
          coordinates.push({ lat: latLng.lat(), lng: latLng.lng() });
        });
        console.log('Polyline coordinates:', coordinates);
        setSelectedArea({
          type: 'polyline',
          coordinates: coordinates
        });
        // Format coordinates for display
        const coordsText = coordinates.map((coord, idx) =>
          `Point ${idx + 1}: ${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`
        ).join('\n');
        setAreaDetails(`Line with ${coordinates.length} points:\n${coordsText}`);
      } else {
        console.log('Unknown shape type:', event.type);
      }
    });

    mapInstanceRef.current = map;

    return () => {
      if (drawnItemsRef.current) {
        drawnItemsRef.current.setMap(null);
        drawnItemsRef.current = null;
      }
    };
  }, [activeTab, leafletLoaded]);

  const deleteDrawing = () => {
    // Delete all multi-polygons if in multi-polygon mode
    if (multiPolygonsRef.current.length > 0) {
      multiPolygonsRef.current.forEach(poly => poly.setMap(null));
      multiPolygonsRef.current = [];
      multiPolygonModeRef.current = false;
    }

    // Delete single shape
    if (drawnItemsRef.current) {
      drawnItemsRef.current.setMap(null);
      drawnItemsRef.current = null;
    }

    setSelectedArea(null);
    setAreaDetails('');
  };

  const searchLocation = () => {
    if (!mapSearchInput.trim() || !mapInstanceRef.current || !window.google?.maps) return;

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: mapSearchInput }, (results, status) => {
      if (status === 'OK' && results[0]) {
        mapInstanceRef.current.setCenter(results[0].geometry.location);
        mapInstanceRef.current.setZoom(13);
      } else {
        alert('Location not found');
      }
    });
  };

  const scrapeRequestBody = () => ({
    country,
    zipcode,
    maxLeads: Number(maxLeads) || 60,
    classifyResidence,
    ...(classifyResidence ? { residenceClassificationOptions: {} } : {})
  });

  const handleScrape = async () => {
    if (!searchQuery || !location) {
      alert('Please enter both search query and location');
      return;
    }
    setIsProcessing(true);
    setLastScrapeInfo(null);
    try {
      const response = await fetch(`${API_URL}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          location,
          ...scrapeRequestBody()
        })
      });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setScrapedData(data.results || []);
      setLastScrapeInfo({
        residenceClassificationRan: data.residenceClassificationRan,
        ignoredFlags: data.ignoredFlags || [],
        count: data.count
      });
    } catch (error) {
      console.error('Scraping error:', error);
      alert('Error scraping data');
    } finally {
      setIsProcessing(false);
    }
  };

  const scrapeMapArea = async () => {
    if (!mapQuery) {
      alert('Please enter a search query');
      return;
    }
    if (!selectedArea) {
      alert('Please draw an area on the map first');
      return;
    }
    setIsProcessing(true);
    setLastScrapeInfo(null);
    try {
      const response = await fetch(`${API_URL}/api/scrape-area`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: mapQuery,
          area: selectedArea,
          ...scrapeRequestBody()
        })
      });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setScrapedData(data.results || []);
      setLastScrapeInfo({
        residenceClassificationRan: data.residenceClassificationRan,
        ignoredFlags: data.ignoredFlags || [],
        count: data.count
      });
    } catch (error) {
      console.error('Scraping error:', error);
      alert('Error scraping data');
    } finally {
      setIsProcessing(false);
    }
  };

  const saveLeadToList = (lead) => {
    setLeads(prev => [{ ...lead, savedAt: new Date().toISOString() }, ...prev]);
    setScrapedData(prev => prev.filter(l => l.id !== lead.id));
  };

  const saveAllFromScraped = () => {
    const stamp = new Date().toISOString();
    setLeads(prev => [...scrapedData.map(l => ({ ...l, savedAt: stamp })), ...prev]);
    setScrapedData([]);
  };

  const rejectLead = (leadId) => setScrapedData(scrapedData.filter(l => l.id !== leadId));
  const deleteLead = (leadId) => setLeads(leads.filter(l => l.id !== leadId));
  const cleanAllData = () => setScrapedData([]);

  const exportScrapedToCSV = () => {
    const csv = [
      ['Company Name', 'Owner', 'Title', 'Industry', 'Phone', 'Address', 'Zipcode', 'City', 'State', 'Country', 'Address class', 'RDI', 'Source'],
      ...scrapedData.map(lead => [
        lead.companyName,
        lead.ownerName || '',
        lead.title || '',
        lead.industry,
        lead.phone,
        lead.address,
        lead.zipcode,
        lead.city,
        lead.state,
        lead.country,
        lead.addressClassification?.value || '',
        lead.addressClassification?.rdi || '',
        lead.source
      ])
    ].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_found_${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToCSV = () => {
    const csv = [
      ['Company Name', 'Industry', 'Owner Name', 'Phone', 'Address', 'Zipcode', 'City', 'Country', 'Address class', 'RDI', 'Source', 'Saved at'],
      ...leads.map(lead => [
        lead.companyName,
        lead.industry,
        lead.ownerName,
        lead.phone,
        lead.address,
        lead.zipcode,
        lead.city,
        lead.country,
        lead.addressClassification?.value || '',
        lead.addressClassification?.rdi || '',
        lead.source,
        lead.savedAt || ''
      ])
    ].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportToJSON = () => {
    const json = JSON.stringify(leads, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white mb-2">SSAI Leads Pro</h1>
          <p className="text-purple-200">Google Places discovery and optional US address classification (Smarty RDI)</p>

          <div className="flex justify-center gap-4 mt-4 flex-wrap">
            <div className={`px-4 py-2 rounded-lg flex items-center gap-2 ${backendHealth?.ok ? 'bg-green-600/20 border border-green-500/50' : 'bg-red-600/20 border border-red-500/50'}`}>
              <div className={`w-2 h-2 rounded-full ${backendHealth?.ok ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
              <span className="text-sm font-medium text-white">
                API: {backendHealth?.ok ? 'Reachable' : 'Unreachable'}
              </span>
            </div>
            <div className={`px-4 py-2 rounded-lg flex items-center gap-2 ${classifyResidence ? 'bg-teal-600/20 border border-teal-500/50' : 'bg-white/10 border border-white/20'}`}>
              <span className="text-sm font-medium text-white">
                After scrape: {classifyResidence ? 'classification on' : 'classification off'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-4 mb-6 flex-wrap">
          <button onClick={() => setActiveTab('map')} className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center gap-2 ${activeTab === 'map' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white/10 text-purple-200 hover:bg-white/20'}`}>
            <MapPin size={18} />
            Map Search
          </button>
          <button onClick={() => setActiveTab('scraper')} className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center gap-2 ${activeTab === 'scraper' ? 'bg-purple-600 text-white shadow-lg' : 'bg-white/10 text-purple-200 hover:bg-white/20'}`}>
            <Search size={18} />
            Text Search
          </button>
        </div>

        <div className="space-y-6">
          {activeTab === 'map' && (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 border border-white/20">
              <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-2">
                <MapPin className="text-purple-400" />
                Draw Area on Map
              </h2>
              <div className="mb-4 p-3 bg-purple-600/20 rounded-lg flex gap-2">
                <input type="text" value={mapSearchInput} onChange={(e) => setMapSearchInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && searchLocation()} placeholder="Enter location..." className="flex-1 px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                <button onClick={searchLocation} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold">Go</button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-purple-200 mb-1">Industry</label>
                <input type="text" value={mapQuery} onChange={(e) => setMapQuery(e.target.value)} placeholder="Enter business type..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              </div>
              <div className="mb-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-purple-200 mb-1">Country (Optional)</label>
                  <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Enter country..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-200 mb-1">Zip Code (Optional)</label>
                  <input type="text" value={zipcode} onChange={(e) => setZipcode(e.target.value)} placeholder="Enter zip code..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-purple-200 mb-1">Maximum leads (Google Places; typical cap ~60 per request)</label>
                <input type="number" value={maxLeads} onChange={(e) => setMaxLeads(e.target.value === '' ? '' : parseInt(e.target.value, 10))} min="1" max="10000" placeholder="Number of leads..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              </div>
              <div className="flex items-center gap-3 p-4 bg-teal-600/20 rounded-lg border border-teal-500/50 mb-4">
                <input
                  type="checkbox"
                  id="classifyResidenceMap"
                  checked={classifyResidence}
                  onChange={(e) => setClassifyResidence(e.target.checked)}
                  className="w-5 h-5 rounded border-2 border-teal-400 bg-white/10 checked:bg-teal-600 checked:border-teal-600 cursor-pointer"
                />
                <label htmlFor="classifyResidenceMap" className="text-white font-medium cursor-pointer flex-1">
                  Classify US addresses after scrape (Smarty — residential / commercial RDI when keys are configured)
                </label>
              </div>
              <div ref={mapRef} className="w-full rounded-xl border-2 border-white/20" style={{ height: '400px', minHeight: '400px' }} />
              <div className="mt-4 p-3 bg-purple-600/20 rounded-lg text-sm text-purple-200">
                <strong>Instructions:</strong><br />
                1. Use search to find a location<br />
                2. Use drawing tools to select an area<br />
                3. Enter business type above<br />
                4. Click "Scrape Selected Area"
              </div>
              {areaDetails && (<div className="mt-3 p-3 bg-purple-600/20 rounded-lg text-sm text-purple-200"><strong>Selected Area:</strong><br />{areaDetails}</div>)}
              <button onClick={scrapeMapArea} disabled={isProcessing} className="w-full mt-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {isProcessing ? <><Loader className="animate-spin" size={20} />Scraping...</> : <><Search size={20} />Scrape Selected Area</>}
              </button>
            </div>
          )}

          {activeTab === 'scraper' && (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 border border-white/20">
              <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-2">
                <Search className="text-purple-400" />
                Text-Based Search
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-purple-200 mb-1">Industry</label>
                  <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Enter business type..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-200 mb-1">Location</label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Enter location..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-purple-200 mb-1">Country (Optional)</label>
                    <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Enter country..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-purple-200 mb-1">Zip Code (Optional)</label>
                    <input type="text" value={zipcode} onChange={(e) => setZipcode(e.target.value)} placeholder="Enter zip code..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-200 mb-1">Maximum leads (Google Places; typical cap ~60 per request)</label>
                  <input type="number" value={maxLeads} onChange={(e) => setMaxLeads(e.target.value === '' ? '' : parseInt(e.target.value, 10))} min="1" max="10000" placeholder="Number of leads..." className="w-full px-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-300 focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                </div>
                <div className="flex items-center gap-3 p-4 bg-teal-600/20 rounded-lg border border-teal-500/50">
                  <input
                    type="checkbox"
                    id="classifyResidenceText"
                    checked={classifyResidence}
                    onChange={(e) => setClassifyResidence(e.target.checked)}
                    className="w-5 h-5 rounded border-2 border-teal-400 bg-white/10 checked:bg-teal-600 checked:border-teal-600 cursor-pointer"
                  />
                  <label htmlFor="classifyResidenceText" className="text-white font-medium cursor-pointer flex-1">
                    Classify US addresses after scrape (Smarty — residential / commercial RDI when keys are configured)
                  </label>
                </div>
                <button onClick={handleScrape} disabled={isProcessing} className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {isProcessing ? <><Loader className="animate-spin" size={20} />Scraping...</> : <><Search size={20} />Start Scraping</>}
                </button>
              </div>
            </div>
          )}

          {lastScrapeInfo?.ignoredFlags?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-amber-100 text-sm">
              <strong className="block mb-1">Server notes</strong>
              <ul className="list-disc list-inside space-y-0.5">
                {lastScrapeInfo.ignoredFlags.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 border border-white/20">
            <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
              <h3 className="text-xl font-semibold text-white">Leads Found ({scrapedData.length})</h3>
              {scrapedData.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={exportScrapedToCSV}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
                  >
                    <Download size={16} />
                    Download
                  </button>
                  <button
                    onClick={cleanAllData}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
                  >
                    <Trash2 size={16} />
                    Clean Data
                  </button>
                  <button
                    onClick={saveAllFromScraped}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-all"
                  >
                    <Plus size={16} />
                    Save all ({scrapedData.length})
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {scrapedData.length === 0 ? (
                <p className="text-purple-300 text-center py-8">No leads found yet</p>
              ) : (
                scrapedData.map(lead => (
                  <div key={lead.id} className="bg-white/10 rounded-lg p-4 border border-white/20">
                    <h4 className="font-semibold text-white mb-2">{lead.companyName}</h4>
                    {lead.ownerName && lead.ownerName !== 'N/A' && (
                      <p className="text-sm text-emerald-300 mb-1">
                        Owner: {lead.ownerName}
                        {lead.title && lead.title !== 'N/A' ? ` · ${lead.title}` : ''}
                      </p>
                    )}
                    <p className="text-sm text-purple-200 mb-1">{lead.phone}</p>
                    <p className="text-sm text-purple-200 mb-1">{lead.address}</p>
                    {lead.addressClassification && (
                      <p className="text-sm text-amber-200 mb-2">
                        Address type: <strong>{lead.addressClassification.value}</strong>
                        {lead.addressClassification.rdi ? ` · RDI: ${lead.addressClassification.rdi}` : ''}
                        {lead.addressClassification.skippedReason ? ` (skipped: ${lead.addressClassification.skippedReason})` : ''}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={() => saveLeadToList(lead)} disabled={isProcessing} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50">
                        <Plus size={16} />Save to list
                      </button>
                      <button onClick={() => rejectLead(lead.id)} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1">
                        <X size={16} />Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 border border-white/20">
            <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
              <h2 className="text-2xl font-semibold text-white flex items-center gap-2">
                <Building2 className="text-purple-400" />
                Saved leads ({leads.length})
              </h2>
              {leads.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={exportToCSV} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-1">
                    <Download size={16} />CSV
                  </button>
                  <button onClick={exportToJSON} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-1">
                    <Download size={16} />JSON
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto">
              {leads.length === 0 ? (
                <div className="text-center py-12">
                  <Building2 size={48} className="mx-auto mb-3 text-purple-400 opacity-50" />
                  <p className="text-purple-300">No saved leads yet</p>
                </div>
              ) : (
                leads.map(lead => (
                  <div key={lead.id} className="bg-white/10 border border-white/20 rounded-lg p-4 hover:bg-white/20 transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-lg text-white">{lead.companyName}</h3>
                        {lead.industry && <p className="text-sm text-purple-300">{lead.industry}</p>}
                      </div>
                      <button onClick={() => deleteLead(lead.id)} className="text-red-400 hover:text-red-300">
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="space-y-1 text-sm text-purple-200">
                      <p><strong>Owner:</strong> {lead.ownerName || '—'}</p>
                      {lead.phone && <p><strong>Phone:</strong> {lead.phone}</p>}
                      {lead.address && <p><strong>Address:</strong> {lead.address}</p>}
                      {lead.addressClassification && (
                        <p><strong>Address type:</strong> {lead.addressClassification.value}
                          {lead.addressClassification.rdi ? ` (${lead.addressClassification.rdi})` : ''}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
