// System devices

import { RuntimeEnvironment } from './env';
import { IOManager } from './iomgr';

/**
 * Programmable Interrupt Controller
 */
export class VPIC {
    private irq: number[];
    private phase: number[];
    private IMR: Uint8Array;
    private IRR: Uint8Array;
    private ISR: Uint8Array;
    private ICW: Uint8Array;

    constructor (iomgr: IOManager) {
        this.irq = [];
        this.phase = [0, 0];
        this.IMR = new Uint8Array([0xFF, 0xFF]);
        this.IRR = new Uint8Array(2);
        this.ISR = new Uint8Array(2);
        this.ICW = new Uint8Array(8);

        iomgr.on(0x20, (_, data) => this.writeOCR(0, data), (_) => this.readOCR(0));
        iomgr.on(0x21, (_, data) => this.writeIMR(0, data), (_) => this.readIMR(0));
        iomgr.on(0xA0, (_, data) => this.writeOCR(1, data), (_) => this.readOCR(1));
        iomgr.on(0xA1, (_, data) => this.writeIMR(1, data), (_) => this.readIMR(1));
    }

    private writeOCR(port: number, data: number): void {
        if (data & 0x10) { // ICW1
            this.phase[port] = 1;
            this.ICW[port * 4] = data;
        } else if (data == 0x20) { // normal EOI
            for (let i = 0; i < 8; i++) {
                const mask = (1 << i);
                if (this.ISR[port] & mask) {
                    this.ISR[port] &= ~mask;
                    this.enqueue(0);
                    break;
                }
            }
        } else {
            // TODO:
        }
    }
    private readOCR(port: number): number {
        // TODO:
        return this.ISR[port];
    }
    private writeIMR(port: number, data: number): void {
        const phase = this.phase[port] || 0;
        if (phase > 0 && phase < 4) { // ICW2-4
            this.ICW[port * 4 + phase] = data;
            if (phase < 4) {
                this.phase[port] = 1 + phase;
            } else {
                this.phase[port] = 0;
            }
        } else {
            this.IMR[port] = data;
        }
    }
    private readIMR(port: number): number {
        return this.IMR[port];
    }
    private enqueue(port: number): void {
        for (let i = 0; i < 8; i++) {
            if (this.irq.length) return;
            const mask = (1 << i);
            if (port == 0 && i == this.ICW[0] && (this.IMR[0] & mask) == 0) {
                this.enqueue(1);
                break;
            }
            if (this.ISR[port] & mask) break;
            if ((this.IRR[port] & mask) && (this.IMR[port] & mask) == 0) {
                this.IRR[port] &= ~mask;
                this.ISR[port] |= mask;
                this.irq.push(port * 8 + i);
            }
        }
    }
    public raiseIRQ(n: number): void {
        if (n < 8) {
            if (n == 0) {
                this.irq.push(0);
            } else {
                this.IRR[0] |= (1 << n);
                this.enqueue(0);
            }
        } else if (n < 16) {
            this.ISR[1] |= (1 << (n - 8));
            this.IRR[0] |= this.ICW[2];
            this.enqueue(0);
        }
    }
    public dequeueIRQ(): number {
        const global_irq = this.irq.shift();
        if (global_irq != null) {
            const port = global_irq >> 3;
            const local_irq = global_irq & 7;
            const mask = 1 << local_irq;
            this.ISR[port] |= mask;
            const vector = (this.ICW[port * 4 + 1] & 0xF8) | local_irq;
            return vector;
        } else {
            return 0;
        }
    }
}

/**
 * Programmable Interval Timer
 */
export class VPIT {
    private cntModes: Uint8Array;
    private cntPhases: number[];
    private cntValues: Uint8Array;
    private p0061_data: number;
    private env: RuntimeEnvironment;

    constructor (env: RuntimeEnvironment) {
        this.env = env;
        this.cntModes = new Uint8Array(3);
        this.cntPhases = [0, 0, 0];
        this.cntValues = new Uint8Array(6);
        this.p0061_data = 0;
    
        env.iomgr.on(0x40, (_, data) => this.outCntReg(0, data));
        env.iomgr.on(0x41, (_, data) => this.outCntReg(1, data));
        env.iomgr.on(0x42, (_, data) => this.outCntReg(2, data));
        env.iomgr.on(0x43, (_, data) => {
            const counter = (data >> 6) & 3;
            const format = (data >> 4) & 3;
            // const mode = (data >> 1) & 7;
            // const bcd = data & 1;
            if (counter < 3 && format > 0) {
                this.cntModes[counter] = data;
                this.cntPhases[counter] = 0;
                this.cntValues[counter * 2] = 0;
                this.cntValues[counter * 2 + 1] = 0;
                switch (counter) {
                    case 0:
                        this.clearTimer();
                        break;
                    case 2:
                        this.noteOff();
                        break;
                }
            }
            return false;
        });
        env.iomgr.on(0x61, (_, data) => {
            const old_data = this.p0061_data;
            this.p0061_data = data;
            const chg_value = old_data ^ data;
            if (chg_value & 0x02){
                if (data & 0x02){
                    this.noteOn();
                }else{
                    this.noteOff();
                }
            }
            return false;
        }, (_) => this.p0061_data);
    }
    private outCntReg(counter: number, data: number): void {
        if (this.cntPhases[counter] != 1) {
            this.cntValues[counter * 2] = data;
            this.cntPhases[counter] = 1;
        } else {
            this.cntValues[counter * 2 + 1] = data;
            this.cntPhases[counter] = 0;
            switch (counter) {
                case 0:
                    this.setTimer();
                    break;
                case 2:
                    if (this.p0061_data & 0x02) {
                        this.noteOn();
                    }
                    break;
            }
        }
    }
    public noteOn(): void {
        const freq = 1193181 / this.getCounter(2);
        this.env.setSound(freq);
    }
    public noteOff(): void {
        this.env.setSound(0);
    }
    public getCounter(counter: number): number {
        let count_value = this.cntValues[counter * 2] + (this.cntValues[counter * 2 + 1] * 256);
        if (!count_value) count_value = 0x10000;
        return count_value;
    }
    public clearTimer(): void {
        this.env.setTimer(0);
    }
    public setTimer(): void {
        this.env.setTimer(this.getCounter(0) / 1193.181);
    }
}


/**
 * Universal Asynchronous Receiver Transmitter
 */
export class UART {
    private env: RuntimeEnvironment;
    private fifo_o: number[];
    private fifo_i: number[];
    private irq: number;
    private IER: number;

    constructor (env: RuntimeEnvironment, base: number, irq: number) {
        this.env = env;
        this.irq = irq;
        this.fifo_o = [];
        this.fifo_i = [];
        env.iomgr.on(base, (_, data) => this.fifo_o.push(data),
            (_) => this.fifo_i.shift() || 0);
        env.iomgr.on(base + 1, (_, data) => this.IER = data, (_) => this.IER);
        env.iomgr.on(base + 5, undefined, (_) => 0x20 | ((this.fifo_i.length > 0) ? 1 : 0));
    }
    public dequeueTX(): number[] {
        const result = this.fifo_o.slice();
        this.fifo_o = [];
        return result;
    }
    public onRX(data: number): void {
        this.fifo_i.push(data & 0xFF);
        if (this.IER & 1) {
            this.env.pic.raiseIRQ(this.irq);
        }
    }
}


/**
 * Real Time Clock
 */
export class RTC {
    public index: number;
    private ram: Uint8Array;

    constructor (env: RuntimeEnvironment) {
        this.ram = new Uint8Array(256);
        env.iomgr.on(0x70, (_, data) => this.index = data, (port) => this.index);
        env.iomgr.on(0x71, (_, data) => this.writeRTC(data), (_) => this.readRTC());
    }
    writeRTC(data: number): void {
        this.ram[this.index] = data;
    }
    // readRTC(): number {
    //     const result = this._readRTC();
    //     console.log('read_rtc', this.index, ('00' + result.toString(16)).slice(-2));
    //     return result;
    // }
    readRTC(): number {
        const toBCD = (n: number) => {
            const a1 = n % 10;
            const a2 = (n / 10) | 0;
            return a1 + (a2 << 4);
        }
        const now = new Date();
        switch (this.index) {
        case 0:
            return toBCD(now.getSeconds());
        case 2:
            return toBCD(now.getMinutes());
        case 4:
            return toBCD(now.getHours());
        case 6:
            return now.getDay();
        case 7:
            return toBCD(now.getDate());
        case 8:
            return toBCD(1 + now.getMonth());
        case 9:
            return toBCD(now.getFullYear() % 100);
        case 0x32:
                return toBCD((now.getFullYear() / 100) | 0);
        default:
            return this.ram[this.index];
        }
    }
}