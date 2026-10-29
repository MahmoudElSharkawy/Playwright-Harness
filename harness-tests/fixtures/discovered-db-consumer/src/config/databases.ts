import {type DBConnectionConfig} from '../utils/DBActions';

const target = JSON.parse(process.env.HARNESS_M8_TARGET!);
const credential = JSON.parse(process.env.M8_DB_CREDENTIAL!);
export const databases: {orders: DBConnectionConfig} = {orders: {
  name: 'orders', server: target.server, port: target.port, database: target.database,
  user: credential.user, password: credential.password, encrypt: target.encrypt,
  trustServerCertificate: target.trustServerCertificate
}};
