import {afterEach,expect,test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import type {ReactElement} from "react";
import type {Resource} from "@infraforge/domain/resource";
import {CachePolicySection} from "../src/features/canvas/components/inspector/CachePolicySection";
import {DataKeyspaceSection} from "../src/features/canvas/components/inspector/DataKeyspaceSection";
import {CacheReadings} from "../src/features/reports/components/CacheReadings";
import {useCanvasStore} from "../src/features/canvas/store/canvasStore";
import {undo,redo} from "../src/features/canvas/history";
const cache:Resource={id:"cache",type:"Cache",x:0,y:0,cachePolicy:{version:2,capacityEntries:256,ttlSeconds:60,singleFlight:true,negativeTtlSeconds:0}};
afterEach(()=>useCanvasStore.getState().clearCanvas());
type Control=ReactElement<{onChange:(event:{target:{value:string}})=>void}>;
type Field=ReactElement<{label?:string;children?:(p:{id:string;describedBy:string})=>Control}>;
const field=(label:string)=>{
 const section=CachePolicySection({resource:useCanvasStore.getState().resources[0]!,disabled:false});
 const children=(section.props.children as ReactElement<{children:Field[]}>).props.children;
 return children.find(c=>c.props.label===label)!.props.children!({id:"test",describedBy:"hint"});
};
test("negative TTL is the only new cache control, bounded, explicit, locked and undoable; capacity edits retain it",()=>{
 const html=renderToStaticMarkup(<CachePolicySection resource={cache} disabled/>);
 expect(html).toContain("Negative cache TTL");expect(html).toContain("Errors are never cached as absence");expect(html).toContain('min="0"');
 expect(html.match(/disabled=""/g)).toHaveLength(html.match(/<(input|button|select)/g)!.length);
 useCanvasStore.getState().loadLayout([cache],[],"layout","Cache");
 field("Negative cache TTL").props.onChange({target:{value:"30"}});
 expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({...cache.cachePolicy,negativeTtlSeconds:30});
 undo();expect(useCanvasStore.getState().resources[0]!.cachePolicy!.negativeTtlSeconds).toBe(0);redo();
 field("Logical cache capacity").props.onChange({target:{value:"128"}});
 expect(useCanvasStore.getState().resources[0]!.cachePolicy).toEqual({...cache.cachePolicy,capacityEntries:128,negativeTtlSeconds:30});
 field("Negative cache TTL").props.onChange({target:{value:"-1"}});expect(useCanvasStore.getState().resources[0]!.cachePolicy!.negativeTtlSeconds).toBe(30);
});
test("the static absent dataset is visible without adding a second editable control",()=>{
 const html=renderToStaticMarkup(<DataKeyspaceSection resource={{id:"db",type:"Database",x:0,y:0,dataKeyspace:{version:1,count:100,absentCount:80}}} disabled/>);
 expect(html).toContain("Initially absent keys: 80");expect(html).toContain("no inserts");
});
test("saved absence readings appear only when recorded, and null remains Unknown",()=>{
 const html=(extra:Record<string,unknown>)=>renderToStaticMarkup(<CacheReadings resource={{id:"cache",cache:{version:1,hits:100,misses:10,expirations:0,evictions:0,coalescedWaiters:0,...extra}} as never} cache/>);
 expect(html({})).not.toContain("Cache: Absent answers");
 expect(html({absentAnswers:90,negativeHits:80,absentSourceReads:10})).toContain("<dt>Cache: Empty source queries</dt><dd>10</dd>");
 expect(html({absentAnswers:0,negativeHits:0,absentSourceReads:0})).toContain("<dt>Cache: Absent answers</dt><dd>0</dd>");
 expect(html({absentAnswers:null,negativeHits:null,absentSourceReads:null})).toContain("<dt>Cache: Negative hits</dt><dd>Unknown</dd>");
});
