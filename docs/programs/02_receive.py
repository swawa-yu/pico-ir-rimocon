from infrared import Receiver

RECEIVER_PIN = 15
receiver = Receiver(RECEIVER_PIN)

while True:
    try:
        signal = receiver.receive()
        if signal:
            print(signal)
    except ValueError as error:
        print("Capture error:", error)
