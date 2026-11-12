#!/usr/bin/env node
'use strict';
/**
 * Composition on random operator chains, on the JavaScript implementation
 * (rules: docs/RULES_ADDITIONAL_TESTS.md, D13).
 * Usage: node js-study/composition_property.cjs
 *  - 10,000 random cases (xorshift32, seed 20261111): 2-9 source records; each channel a value, applicable
 *    but missing, or not applicable, with or without a declared scope; provenance and lineage.
 *  - The records are split at random into consecutive groups. typedMeet over the group results must equal
 *    typedMeet over all sources: support per channel, unavailable channels, scopes, provenance, lineage.
 *  - Control: a composition that drops an inherited unavailable state must be caught.
 *  - Exits non-zero on any mismatch or if the control is not caught.
 */
const path=require('node:path');
const {typedMeet}=require(path.join(__dirname,'reference','compiled','typedEvidenceOperators.js'));
const CASES=10000,SEED=20261111;
const CHANNELS=['raw-measured-support','geometric-interpolation-support','model-support'];
const SCOPES=['a','b','c'];

function xorshift32(seed){let s=seed>>>0;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
const int=(rng,a,b)=>a+Math.floor(rng()*(b-a+1));
function subset(rng,arr,k){const p=[...arr];for(let i=p.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[p[i],p[j]]=[p[j],p[i]];}return p.slice(0,k).sort();}

function randomSource(rng,k){
  const support={},applicability={};
  for(const ch of CHANNELS){
    const u=rng(),scope=rng()<0.6?undefined:subset(rng,SCOPES,int(rng,1,3));
    if(u<0.6){support[ch]=Math.round(rng()*1000)/1000;applicability[ch]=scope?{applicable:true,scope}:{applicable:true};}
    else if(u<0.8){applicability[ch]=scope?{applicable:true,scope}:{applicable:true};}
    else applicability[ch]={applicable:false};
  }
  return{provenance:subset(rng,['measured','interpolated'],int(rng,1,2)),support,applicability,lineage:[`s${k}`]};
}
function canon(e){
  const ch={};
  for(const c of CHANNELS){
    if((e.unavailable||[]).includes(c))ch[c]='unavailable';
    else if(e.support[c]!=null)ch[c]=[e.support[c],e.scope&&e.scope[c]?[...e.scope[c]].sort():null];
    else ch[c]='absent';
  }
  return JSON.stringify({ch,provenance:[...e.provenance].sort(),lineage:[...(e.lineage||[])].sort()});
}
function parts(rng,sources){
  const n=sources.length,cuts=subset(rng,Array.from({length:n-1},(_,i)=>i+1),int(rng,0,n-1)).sort((a,b)=>a-b),b=[0,...cuts,n];
  return b.slice(0,-1).map((s,i)=>sources.slice(s,b[i+1]));
}
// control: a group result that forgets its unavailable channels
const forget=e=>{const{unavailable,...rest}=e;return rest;};

function run(seed,cases,broken){
  const rng=xorshift32(seed);let mismatches=0,groups=0,withUnavailable=0,valueResults=0;
  for(let c=0;c<cases;c++){
    const sources=Array.from({length:int(rng,2,9)},(_,k)=>randomSource(rng,k)),ps=parts(rng,sources);
    groups+=ps.length;
    const direct=typedMeet(sources),mid=ps.map(p=>typedMeet(p)),composed=typedMeet(broken?mid.map(forget):mid);
    if((direct.unavailable||[]).length)withUnavailable++;
    valueResults+=Object.keys(direct.support).length;
    if(canon(direct)!==canon(composed))mismatches++;
  }
  return{cases,groups,casesWithAnUnavailableChannel:withUnavailable,channelResultsWithAValue:valueResults,mismatches};
}
const main=run(SEED,CASES,false),control=run(SEED+1,2000,true);
console.log(JSON.stringify({seed:SEED,...main,control:{cases:control.cases,caught:control.mismatches}},null,1));
process.exit(main.mismatches===0&&control.mismatches>0?0:1);
