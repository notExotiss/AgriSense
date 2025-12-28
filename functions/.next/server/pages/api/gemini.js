"use strict";(()=>{var e={};e.id=351,e.ids=[351],e.modules={145:e=>{e.exports=require("next/dist/compiled/next-server/pages-api.runtime.prod.js")},6249:(e,t)=>{Object.defineProperty(t,"l",{enumerable:!0,get:function(){return function e(t,i){return i in t?t[i]:"then"in t&&"function"==typeof t.then?t.then(t=>e(t,i)):"function"==typeof t&&"default"===i?t:void 0}}})},9529:(e,t,i)=>{i.r(t),i.d(t,{config:()=>d,default:()=>l,routeModule:()=>u});var a={};i.r(a),i.d(a,{default:()=>s});var n=i(1802),r=i(7153),o=i(6249);async function s(e,t){if("POST"!==e.method)return t.status(405).end();try{let{prompt:i,ndviData:a,weatherData:n,timeSeriesData:r,analysisType:o="basic"}=e.body||{};if(!i)return t.status(400).json({error:"prompt_required"});let s="";return s="comprehensive"===o?function(e,t,i){var a;let{stats:n}=e,r=i?.summary||{trend:"stable",averageNDVI:n?.mean??0,seasonality:{detected:!1}};(t||{}).weather;let o="COMPREHENSIVE FARM ANALYSIS\n\n";return o+=`CURRENT VEGETATION STATUS:
- Mean NDVI: ${n.mean.toFixed(3)} (${(a=n.mean)>.6?"Excellent":a>.4?"Good":a>.2?"Moderate":"Poor"})
- Range: ${n.min.toFixed(3)} - ${n.max.toFixed(3)}

WEATHER CONDITIONS:
- Temperature: N/A
- Precipitation: N/A
- Humidity: N/A
- Conditions: N/A

HISTORICAL TRENDS:
- Trend: ${r.trend}
- Average NDVI: ${r.averageNDVI.toFixed(3)}
`,r.seasonality.detected&&(o+=`- Peak season: Month ${r.seasonality.peakMonth+1}
- Seasonal amplitude: ${r.seasonality.amplitude.toFixed(3)}
`),o+="\nRECOMMENDATIONS:\n",["Inspect low-NDVI patches and verify irrigation coverage","Schedule soil sampling for nutrient analysis","Prioritize weed/pest scouting near field edges"].forEach((e,t)=>{o+=`${t+1}. ${e}
`}),o}(a,n,r):"weather"===o?function(e,t){var i,a,n,r,o,s;let{stats:l}=e,d=t&&t.weather||{temperature:{current:null},precipitation:{daily:null},humidity:{value:null}},u="WEATHER-NDVI CORRELATION ANALYSIS\n\n",m=(i=Number(d.temperature?.current??0),a=l.mean,i>30&&a<.4?"High temperature stress likely":i<10&&a<.3?"Cold stress affecting growth":i>=15&&i<=25&&a>.5?"Optimal temperature conditions":"Temperature within acceptable range"),c=(n=Number(d.precipitation?.daily??0),r=l.mean,n<1&&r<.3?"Drought stress evident":n>10&&r<.4?"Excessive moisture may be affecting growth":n>=2&&n<=8&&r>.4?"Adequate moisture levels":"Precipitation impact within normal range"),p=(o=Number(d.humidity?.value??0),s=l.mean,o<30&&s<.4?"Low humidity contributing to stress":o>80&&s<.4?"High humidity may promote disease":o>=40&&o<=70&&s>.4?"Optimal humidity conditions":"Humidity levels acceptable");return u+=`Temperature Impact: ${m}
Precipitation Impact: ${c}
Humidity Impact: ${p}

RECOMMENDATIONS:
`,["Adjust irrigation schedule","Monitor canopy temperature mid-afternoon","Add windbreaks if persistent high winds"].forEach((e,t)=>{u+=`${t+1}. ${e}
`}),u}(a,n):"trend"===o?function(e){let{summary:t,timeSeries:i}=e,a="TREND ANALYSIS REPORT\n\n";a+=`Overall Trend: ${t.trend}
Average NDVI: ${t.averageNDVI.toFixed(3)}
Data Points: ${t.totalPoints}

`,t.seasonality.detected&&(a+=`SEASONAL PATTERNS:
- Peak growing season: Month ${t.seasonality.peakMonth+1}
- Low season: Month ${t.seasonality.lowMonth+1}
- Seasonal variation: ${t.seasonality.amplitude.toFixed(3)}

`);let n=function(e){if(e.length<2)return"insufficient_data";let t=e[0].ndvi,i=e[e.length-1].ndvi-t;return i>.05?"improving":i<-.05?"declining":"stable"}(i.slice(-10));return a+=`Recent Trend (last 10 points): ${n}

RECOMMENDATIONS:
`,["Investigate variance spikes","Track NDVI after rainfall events","Compare with prior seasons at same month"].forEach((e,t)=>{a+=`${t+1}. ${e}
`}),a}(r):function(e){let t=e.match(/min=([\d.]+), max=([\d.]+), mean=([\d.]+)/);if(!t)return"Basic NDVI summary:\n- Unable to parse NDVI values from prompt.";let[,i,a,n]=t;parseFloat(i),parseFloat(a);let r=parseFloat(n),o="",s=[];return r>.6?(o="\uD83C\uDF31 Excellent vegetation health detected. The NDVI values indicate dense, healthy vegetation with good chlorophyll content.",s=["Continue current management practices","Monitor for optimal harvest timing","Consider precision fertilization for peak areas"]):r>.4?(o="\uD83C\uDF3F Good vegetation health with some variation. The area shows healthy vegetation but with some spatial variability.",s=["Investigate areas with lower NDVI values","Check irrigation uniformity across the field","Consider targeted nutrient application"]):r>.2?(o="⚠️ Moderate vegetation stress detected. The NDVI values suggest some stress or sparse vegetation.",s=["Immediate field inspection recommended","Check for pest, disease, or water stress","Consider soil testing in affected areas"]):(o="\uD83D\uDEA8 Significant vegetation stress or sparse coverage. The NDVI values indicate poor vegetation health.",s=["Urgent field assessment required","Investigate potential crop failure causes","Consider replanting in severely affected areas"]),`${o}

Recommendations:
${s.map((e,t)=>`${t+1}. ${e}`).join("\n")}`}(i),t.status(200).json({success:!0,suggestion:s,output:s,model:"gemini-pro-enhanced",analysisType:o,timestamp:new Date().toISOString()})}catch(e){return console.error("gemini API error",e?.message||e),t.status(500).json({error:"analysis_failed",message:String(e?.message||e)})}}let l=(0,o.l)(a,"default"),d=(0,o.l)(a,"config"),u=new n.PagesAPIRouteModule({definition:{kind:r.x.PAGES_API,page:"/api/gemini",pathname:"/api/gemini",bundlePath:"",filename:""},userland:a})},7153:(e,t)=>{var i;Object.defineProperty(t,"x",{enumerable:!0,get:function(){return i}}),function(e){e.PAGES="PAGES",e.PAGES_API="PAGES_API",e.APP_PAGE="APP_PAGE",e.APP_ROUTE="APP_ROUTE"}(i||(i={}))},1802:(e,t,i)=>{e.exports=i(145)}};var t=require("../../webpack-api-runtime.js");t.C(e);var i=t(t.s=9529);module.exports=i})();