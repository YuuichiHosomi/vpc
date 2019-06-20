# Virtual Playground

A PC Emulator implemented by WebAssembly.

## THIS VERSION

- THIS IS JUNK

## Implemented hardware

- CPU: 80186?
  - Don't implement: AAA AAS AAM AAD DAS DAA SETALC and minor instructions
- Memory: 640KB ought to be enough for anybody.
- I/O:
  - i8259 PIC
  - i8254 Timer & Sound
  - UART (port 3F8 only)

## Requirements

- Google Chrome
  - Currently, other web browsers don't support SharedArrayBuffer.

## License

Copyright (C)2019 Nerry
