import { Injectable, OnDestroy } from '@angular/core';
import { ChallengeService, Challenge } from './challenge.service'
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs/Subject';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { Observable } from 'rxjs/Observable';
import { merge } from 'rxjs/observable/merge';
import { map } from 'rxjs/operators/map';
import { scan } from 'rxjs/operators/scan';
import { TrackService } from '../track.service';
import PouchDB from 'pouchdb';
import { REMOTE_COUCH } from '../app.constants';


export interface RpMessage {
  schema: 'message';
  _id?: string;
  type: 'narrator'|'ooc'|'chara'|'image';
  timestamp?: number;
  edited?: number;
  content: string;
  charaId?: string;
  challenge?: string;
  url?: string;
  ipid?: string;
}

export interface RpChara {
  schema: 'chara';
  _id?: string;
  name: string;
  color: string;
}

export type RpVoice = RpChara|'narrator'|'ooc';

@Injectable()
export class RpService implements OnDestroy {

  private readonly challenge: Challenge;

  public readonly loaded: Promise<boolean>;
  public readonly notFound: Promise<boolean>;
  public readonly rpCode: string;
  public title: string = null;
  public desc: string = null;

  public messages: Readonly<RpMessage>[] = null;
  public messagesById: Map<string, RpMessage> = null;
  public charas: Readonly<RpChara>[] = null;
  public charasById: Map<string, RpChara> = null;

  public readonly newMessages$: Observable<RpMessage> = new Subject();
  
  public readonly messages$: Observable<RpMessage[]> = new ReplaySubject(1);
  public readonly messagesById$: Observable<Map<string, RpMessage>>;

  public readonly charas$: Observable<RpChara[]> = new ReplaySubject(1);
  public readonly charasById$: Observable<Map<string, RpChara>>;

  private readonly db: PouchDB.Database<RpMessage | RpChara>;
  private readonly remoteDb: PouchDB.Database<RpMessage | RpChara>;
  private syncHandler: PouchDB.Replication.Sync<RpMessage | RpChara>;

  constructor(
    challengeService: ChallengeService,
    route: ActivatedRoute,
    private track: TrackService
  ) {

    this.rpCode = route.snapshot.paramMap.get('rpCode');
    this.challenge = challengeService.challenge;
    // TODO change all these
    this.loaded = Promise.resolve(true);
    this.notFound = Promise.resolve(false);
    this.title = 'FAKE TITLE';
    this.desc = 'FAKE DESC';

    // if it's safari, use the websql adapter, since the indexeddb one doesn't seem to work
    let adapter = navigator.userAgent.match(/Version\/[\d\.]+.*Safari/) ? 'websql' : undefined;
    this.db = new PouchDB('rpnow_'+this.rpCode, { adapter });

    this.remoteDb = new PouchDB(`${REMOTE_COUCH}/testrp`);

    // observables
    this.messagesById$ = this.messages$.pipe(
      map(msgs => msgs.reduce((map, msg) => map.set(msg._id, msg), new Map()))
    )

    this.charasById$ = this.charas$.pipe(
      map(charas => charas.reduce((map, chara) => map.set(chara._id, chara), new Map()))
    )

    // access values directly
    this.messages$.subscribe(messages => this.messages = messages);
    this.messagesById$.subscribe(messagesById => this.messagesById = messagesById);
    this.charas$.subscribe(charas => this.charas = charas);
    this.charasById$.subscribe(charasById => this.charasById = charasById);

    // begin sync
    this.sync()

  }

  private sync() {
    this.syncHandler = this.db.sync(this.remoteDb, {live: true})
      .on('paused', err => {
        if (err) return console.error('BISECTED')
        else this.update()
      })
      .on('error', err => {
        setTimeout(() => this.sync(), 1000)
      })
  }

  private update() {
    this.db.allDocs({include_docs: true}).then(res => {
      let docs = res.rows.map(row => row.doc)
      let msgs = docs.filter((doc:any) => doc.schema === 'message') as RpMessage[]
      let charas = docs.filter((doc:any) => doc.schema === 'chara') as RpChara[]

      (this.messages$ as Subject<RpMessage[]>).next(msgs);
      (this.charas$ as Subject<RpChara[]>).next(charas);
    });

    // this.socket.on('add message', msg => this.newMessagesSubject.next(msg));
  }

  public async addMessage(content:string, voice: RpVoice) {
    let msg: RpMessage = {
      schema: 'message',
      content,
      ... this.typeFromVoice(voice),
      challenge: this.challenge.hash
    }
    this.track.event('Messages', 'create', msg.type, content.length);
    
    await this.db.post(msg)
  }

  public async addChara(name: string, color: string) {
    let chara: RpChara = {
      schema: 'chara',
      name,
      color
    }
    this.track.event('Charas', 'create');
    
    return await this.db.post(chara).then(({id}) => {
      chara._id = id;
      return chara
    })
  }

  public async addImage(url: string) {
    this.track.event('Messages', 'create', 'image');
    
    // let msg:RpMessage = await this.socketEmit('add image', url);
    // this.newMessagesSubject.next(msg);

    // return msg;
  }

  public async editMessage(id: string, content: string) {
    this.track.event('Messages', 'edit', null, content.length);
    
    // await this.socketEmit('edit message', { id, content, secret: this.challenge.secret });
  }

  // because rp service is provided in rp component, this is called when navigating away from an rp
  public ngOnDestroy() {
    this.db.close();
    (this.newMessages$ as Subject<any>).complete();
    (this.messages$ as Subject<any>).complete();
    (this.charas$ as Subject<any>).complete();
  }

  // use in ngFor
  public trackById(index: number, item: RpMessage|RpChara) {
    return item._id;
  }

  public isSpecialVoice(voiceStr: string) {
    return ['narrator', 'ooc'].includes(voiceStr)
  }

  public typeFromVoice(voice: RpVoice): {type:'narrator'|'ooc'|'chara', charaId?:string} {
    if (typeof voice === 'string') return { type: voice }
    else return { type: 'chara', charaId: voice._id }
  }

  public getVoice(voiceStr: string): RpVoice {
    if (this.isSpecialVoice(voiceStr)) {
      return voiceStr as 'narrator'|'ooc'
    }
    else {
      return this.charasById[voiceStr]
    }
  }

}
