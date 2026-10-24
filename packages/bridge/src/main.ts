#!/usr/bin/env node
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {EngineClient} from './client.js';
import {createBridge} from './server.js';
const path=process.env.QASPIDER_ENGINE_CONNECTION_FILE;if(!path)throw new Error('Private QASPIDER_ENGINE_CONNECTION_FILE required');
const server=createBridge(EngineClient.fromFile(path));await server.connect(new StdioServerTransport());
