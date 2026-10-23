import type {ArtifactStorage,ArtifactKind} from '../../core/src/index.js';
/** A test run includes its child navigation runs; their separate IDs cannot multiply its quota. */
export class RunArtifactBudget implements ArtifactStorage{
 private allocated=0;
 constructor(private readonly delegate:ArtifactStorage,private readonly limit:()=>number){}
 put(runId:string,data:Uint8Array,kind:ArtifactKind){if(this.allocated+data.byteLength>this.limit())throw new Error('Test-run quota exceeded');const record=this.delegate.put(runId,data,kind);this.allocated+=record.sizeBytes;return record;}
 read(id:string){return this.delegate.read(id);}
 finishRun(id:string){this.delegate.finishRun(id);}
 delete(id:string){this.delegate.delete(id);}
 prune(){return this.delegate.prune();}
}
