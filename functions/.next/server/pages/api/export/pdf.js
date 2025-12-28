"use strict";(()=>{var t={};t.id=301,t.ids=[301],t.modules={145:t=>{t.exports=require("next/dist/compiled/next-server/pages-api.runtime.prod.js")},6249:(t,e)=>{Object.defineProperty(e,"l",{enumerable:!0,get:function(){return function t(e,a){return a in e?e[a]:"then"in e&&"function"==typeof e.then?e.then(e=>t(e,a)):"function"==typeof e&&"default"===a?e:void 0}}})},5474:(t,e,a)=>{a.r(e),a.d(e,{config:()=>l,default:()=>d,routeModule:()=>c});var i={};a.r(i),a.d(i,{default:()=>n});var s=a(1802),r=a(7153),o=a(6249);async function n(t,e){if("POST"!==t.method)return e.status(405).end();try{let{ndviData:a,soilData:i,etData:s,weatherData:r,bbox:o,location:n}=t.body||{};if(!a)return e.status(400).json({error:"ndvi_data_required",message:"NDVI data is required for report generation"});let d=function(t){var e,a;let{ndviData:i,soilData:s,etData:r,weatherData:o,bbox:n,location:d,timestamp:l}=t;return`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AgriSense Analysis Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .report-container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            border-bottom: 3px solid #16a34a;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #16a34a;
            margin: 0;
            font-size: 2.5em;
        }
        .header p {
            color: #666;
            margin: 10px 0 0 0;
        }
        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e5e5e5;
            border-radius: 8px;
        }
        .section h2 {
            color: #16a34a;
            margin-top: 0;
            border-bottom: 2px solid #e5e5e5;
            padding-bottom: 10px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            text-align: center;
        }
        .stat-value {
            font-size: 1.5em;
            font-weight: bold;
            color: #16a34a;
        }
        .stat-label {
            color: #666;
            font-size: 0.9em;
        }
        .health-indicator {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-weight: bold;
            margin: 5px 0;
        }
        .health-good { background: #d1fae5; color: #065f46; }
        .health-moderate { background: #fef3c7; color: #92400e; }
        .health-poor { background: #fee2e2; color: #991b1b; }
        .recommendations {
            background: #f0f9ff;
            border-left: 4px solid #0ea5e9;
            padding: 15px;
            margin: 15px 0;
        }
        .recommendations h3 {
            margin-top: 0;
            color: #0ea5e9;
        }
        .recommendations ul {
            margin: 10px 0;
            padding-left: 20px;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e5e5;
            color: #666;
        }
        @media print {
            body { background: white; }
            .report-container { box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="header">
            <h1>🌱 AgriSense Analysis Report</h1>
            <p>Agricultural Intelligence Platform</p>
            <p><strong>Location:</strong> ${d} | <strong>Generated:</strong> ${new Date(l).toLocaleString()}</p>
        </div>

        <div class="section">
            <h2>📊 NDVI Vegetation Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${i.stats?.mean?.toFixed(3)||"N/A"}</div>
                    <div class="stat-label">Mean NDVI</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${i.stats?.min?.toFixed(3)||"N/A"}</div>
                    <div class="stat-label">Minimum NDVI</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${i.stats?.max?.toFixed(3)||"N/A"}</div>
                    <div class="stat-label">Maximum NDVI</div>
                </div>
            </div>
            <div class="health-indicator ${(e=i.stats?.mean)>.4?"health-good":e>.2?"health-moderate":"health-poor"}">
                ${(a=i.stats?.mean)>.4?"✅ Healthy Vegetation":a>.2?"⚠️ Moderate Vegetation":"❌ Stressed Vegetation"}
            </div>
        </div>

        ${s?`
        <div class="section">
            <h2>💧 Soil Moisture Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${s.stats?.mean?.toFixed(3)||"N/A"} m\xb3/m\xb3</div>
                    <div class="stat-label">Mean Soil Moisture</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${s.source||"N/A"}</div>
                    <div class="stat-label">Data Source</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${s.resolution||"N/A"}</div>
                    <div class="stat-label">Resolution</div>
                </div>
            </div>
            <p><strong>Description:</strong> ${s.description||"Soil moisture content analysis"}</p>
        </div>
        `:""}

        ${r?`
        <div class="section">
            <h2>🌡️ Evapotranspiration Analysis</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${r.stats?.mean?.toFixed(2)||"N/A"} mm/day</div>
                    <div class="stat-label">Mean ET</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${r.source||"N/A"}</div>
                    <div class="stat-label">Data Source</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${r.resolution||"N/A"}</div>
                    <div class="stat-label">Resolution</div>
                </div>
            </div>
            <p><strong>Description:</strong> ${r.description||"Daily evapotranspiration analysis"}</p>
        </div>
        `:""}

        ${o?`
        <div class="section">
            <h2>🌤️ Weather Conditions</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${o.current?.temperature||"N/A"}\xb0C</div>
                    <div class="stat-label">Temperature</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${o.current?.humidity||"N/A"}%</div>
                    <div class="stat-label">Humidity</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${o.current?.condition||"N/A"}</div>
                    <div class="stat-label">Conditions</div>
                </div>
            </div>
        </div>
        `:""}

        <div class="section">
            <h2>🎯 Recommendations</h2>
            <div class="recommendations">
                <h3>Based on Current Analysis:</h3>
                <ul>
                    ${function(t,e,a,i){let s=[];return t?.stats?.mean<.3&&(s.push("Consider irrigation to improve vegetation health"),s.push("Check for pest or disease issues")),e?.stats?.mean<.2&&s.push("Soil moisture is low - irrigation recommended"),a?.stats?.mean>6&&s.push("High evapotranspiration - monitor water usage closely"),i?.current?.temperature>30&&s.push("High temperatures detected - increase irrigation frequency"),0===s.length&&(s.push("Continue current management practices"),s.push("Monitor conditions regularly")),s.map(t=>`<li>${t}</li>`).join("")}(i,s,r,o)}
                </ul>
            </div>
        </div>

        <div class="section">
            <h2>📍 Location Details</h2>
            <p><strong>Bounding Box:</strong> [${n?.join(", ")||"N/A"}]</p>
            <p><strong>Analysis Area:</strong> ${function(t){if(!t||4!==t.length)return"N/A";let[e,a,i,s]=t;return(12321*Math.abs((i-e)*(s-a))).toFixed(2)}(n)} km\xb2</p>
        </div>

        <div class="footer">
            <p>Report generated by AgriSense Agricultural Intelligence Platform</p>
            <p>For more information, visit: https://brightbite-81e92.web.app</p>
        </div>
    </div>
</body>
</html>
  `}({ndviData:a,soilData:i,etData:s,weatherData:r,bbox:o,location:n||"Unknown Location",timestamp:new Date().toISOString()});return e.status(200).json({success:!0,html:d,message:"Report generated successfully. Open in new window to print/save as PDF."})}catch(t){return console.error("PDF export error",t?.message||t),e.status(500).json({error:"pdf_generation_failed",message:String(t?.message||t)})}}let d=(0,o.l)(i,"default"),l=(0,o.l)(i,"config"),c=new s.PagesAPIRouteModule({definition:{kind:r.x.PAGES_API,page:"/api/export/pdf",pathname:"/api/export/pdf",bundlePath:"",filename:""},userland:i})},7153:(t,e)=>{var a;Object.defineProperty(e,"x",{enumerable:!0,get:function(){return a}}),function(t){t.PAGES="PAGES",t.PAGES_API="PAGES_API",t.APP_PAGE="APP_PAGE",t.APP_ROUTE="APP_ROUTE"}(a||(a={}))},1802:(t,e,a)=>{t.exports=a(145)}};var e=require("../../../webpack-api-runtime.js");e.C(t);var a=e(e.s=5474);module.exports=a})();