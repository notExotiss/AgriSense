"use strict";(()=>{var e={};e.id=351,e.ids=[351],e.modules={145:e=>{e.exports=require("next/dist/compiled/next-server/pages-api.runtime.prod.js")},6249:(e,t)=>{Object.defineProperty(t,"l",{enumerable:!0,get:function(){return function e(t,a){return a in t?t[a]:"then"in t&&"function"==typeof t.then?t.then(t=>e(t,a)):"function"==typeof t&&"default"===a?t:void 0}}})},9529:(e,t,a)=>{a.r(t),a.d(t,{config:()=>d,default:()=>l,routeModule:()=>u});var i={};a.r(i),a.d(i,{default:()=>o});var n=a(1802),r=a(7153),s=a(6249);async function o(e,t){if("POST"!==e.method)return t.status(405).end();try{let{prompt:a,ndviData:i,weatherData:n,timeSeriesData:r,analysisType:s="basic"}=e.body||{};if(!a)return t.status(400).json({error:"prompt_required"});let o="";return o="comprehensive"===s?function(e,t,a){var i;let{stats:n}=e,r=a?.summary||{trend:"stable",averageNDVI:n?.mean??0,seasonality:{detected:!1}};(t||{}).weather;let s="COMPREHENSIVE FARM ANALYSIS\n\n";return s+=`CURRENT VEGETATION STATUS:
- Mean NDVI: ${n.mean.toFixed(3)} (${(i=n.mean)>.6?"Excellent":i>.4?"Good":i>.2?"Moderate":"Poor"})
- Range: ${n.min.toFixed(3)} - ${n.max.toFixed(3)}

WEATHER CONDITIONS:
- Temperature: N/A
- Precipitation: N/A
- Humidity: N/A
- Conditions: N/A

HISTORICAL TRENDS:
- Trend: ${r.trend}
- Average NDVI: ${r.averageNDVI.toFixed(3)}
`,r.seasonality.detected&&(s+=`- Peak season: Month ${r.seasonality.peakMonth+1}
- Seasonal amplitude: ${r.seasonality.amplitude.toFixed(3)}
`),s+="\nRECOMMENDATIONS:\n",["Inspect low-NDVI patches and verify irrigation coverage","Schedule soil sampling for nutrient analysis","Prioritize weed/pest scouting near field edges"].forEach((e,t)=>{s+=`${t+1}. ${e}
`}),s}(i,n,r):"weather"===s?function(e,t){var a,i,n,r,s,o;let{stats:l}=e,d=t&&t.weather||{temperature:{current:null},precipitation:{daily:null},humidity:{value:null}},u="WEATHER-NDVI CORRELATION ANALYSIS\n\n",m=(a=Number(d.temperature?.current??0),i=l.mean,a>30&&i<.4?"High temperature stress likely":a<10&&i<.3?"Cold stress affecting growth":a>=15&&a<=25&&i>.5?"Optimal temperature conditions":"Temperature within acceptable range"),c=(n=Number(d.precipitation?.daily??0),r=l.mean,n<1&&r<.3?"Drought stress evident":n>10&&r<.4?"Excessive moisture may be affecting growth":n>=2&&n<=8&&r>.4?"Adequate moisture levels":"Precipitation impact within normal range"),p=(s=Number(d.humidity?.value??0),o=l.mean,s<30&&o<.4?"Low humidity contributing to stress":s>80&&o<.4?"High humidity may promote disease":s>=40&&s<=70&&o>.4?"Optimal humidity conditions":"Humidity levels acceptable");return u+=`Temperature Impact: ${m}
Precipitation Impact: ${c}
Humidity Impact: ${p}

RECOMMENDATIONS:
`,["Adjust irrigation schedule","Monitor canopy temperature mid-afternoon","Add windbreaks if persistent high winds"].forEach((e,t)=>{u+=`${t+1}. ${e}
`}),u}(i,n):"trend"===s?function(e){let{summary:t,timeSeries:a}=e,i="TREND ANALYSIS REPORT\n\n";i+=`Overall Trend: ${t.trend}
Average NDVI: ${t.averageNDVI.toFixed(3)}
Data Points: ${t.totalPoints}

`,t.seasonality.detected&&(i+=`SEASONAL PATTERNS:
- Peak growing season: Month ${t.seasonality.peakMonth+1}
- Low season: Month ${t.seasonality.lowMonth+1}
- Seasonal variation: ${t.seasonality.amplitude.toFixed(3)}

`);let n=function(e){if(e.length<2)return"insufficient_data";let t=e[0].ndvi,a=e[e.length-1].ndvi-t;return a>.05?"improving":a<-.05?"declining":"stable"}(a.slice(-10));return i+=`Recent Trend (last 10 points): ${n}

RECOMMENDATIONS:
`,["Investigate variance spikes","Track NDVI after rainfall events","Compare with prior seasons at same month"].forEach((e,t)=>{i+=`${t+1}. ${e}
`}),i}(r):function(e){let t=e.match(/min=([\d.]+), max=([\d.]+), mean=([\d.]+)/);if(!t)return"Basic NDVI summary:\n- Unable to parse NDVI values from prompt.";let[,a,i,n]=t;parseFloat(a),parseFloat(i);let r=parseFloat(n),s="",o=[];return r>.6?(s="\uD83C\uDF31 Excellent vegetation health detected. The NDVI values indicate dense, healthy vegetation with good chlorophyll content.",o=["Continue current management practices","Monitor for optimal harvest timing","Consider precision fertilization for peak areas"]):r>.4?(s="\uD83C\uDF3F Good vegetation health with some variation. The area shows healthy vegetation but with some spatial variability.",o=["Investigate areas with lower NDVI values","Check irrigation uniformity across the field","Consider targeted nutrient application"]):r>.2?(s="⚠️ Moderate vegetation stress detected. The NDVI values suggest some stress or sparse vegetation.",o=["Immediate field inspection recommended","Check for pest, disease, or water stress","Consider soil testing in affected areas"]):(s="\uD83D\uDEA8 Significant vegetation stress or sparse coverage. The NDVI values indicate poor vegetation health.",o=["Urgent field assessment required","Investigate potential crop failure causes","Consider replanting in severely affected areas"]),`${s}

Recommendations:
${o.map((e,t)=>`${t+1}. ${e}`).join("\n")}`}(a),t.status(200).json({success:!0,suggestion:o,output:o,model:"gemini-pro-enhanced",analysisType:s,timestamp:new Date().toISOString()})}catch(a){console.error("gemini API error",a?.message||a);let e=String(a?.message||a).toLowerCase();if(e.includes("rate limit")||e.includes("429"))return t.status(429).json({error:"rate_limit_exceeded",message:"API rate limit exceeded. Please wait a moment and try again.",retryAfter:60});return t.status(500).json({error:"analysis_failed",message:String(a?.message||a)})}}let l=(0,s.l)(i,"default"),d=(0,s.l)(i,"config"),u=new n.PagesAPIRouteModule({definition:{kind:r.x.PAGES_API,page:"/api/gemini",pathname:"/api/gemini",bundlePath:"",filename:""},userland:i})},7153:(e,t)=>{var a;Object.defineProperty(t,"x",{enumerable:!0,get:function(){return a}}),function(e){e.PAGES="PAGES",e.PAGES_API="PAGES_API",e.APP_PAGE="APP_PAGE",e.APP_ROUTE="APP_ROUTE"}(a||(a={}))},1802:(e,t,a)=>{e.exports=a(145)}};var t=require("../../webpack-api-runtime.js");t.C(e);var a=t(t.s=9529);module.exports=a})();