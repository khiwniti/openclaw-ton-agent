struct Storage {
    counter: uint64,
}

struct Increment {
    queryId: uint64,
    step: uint64,
}

contract Counter {
    storage: Storage
    incomingMessages: Increment
}

get fun getCounter(): uint64 {
    return Storage.fromCell(contract.getData()).counter;
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy Increment.fromSlice(in.body);
    match (msg) {
        Increment => {
            var storage = Storage.fromCell(contract.getData());
            storage.counter = storage.counter + msg.step;
            msg.forceLoadLazyObject().assertEnd();
            contract.setData(storage.toCell());
        }
    }
}